import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import { describe, expect, test, vi } from 'vitest';
import { ReplayGhostRenderer } from '../app/rendering/replayGhostRenderer.js';
import { destroyDisplayChildren } from '../rendering/displayLifecycle.js';

describe('replay rendering work and shared display ownership', () => {
  test('moving ghosts reuse halo geometry until the rendered appearance changes', () => {
    const layer = new Container();
    const renderer = new ReplayGhostRenderer();
    const ghost = { id: 'lap', label: 'Best lap', color: '#00ff84', opacity: 0.35, visible: true, x: 100, y: 200, heading: 0.4 };
    const render = () => renderer.render({ replayGhosts: [ghost] }, { textures: { car: Texture.WHITE }, replayGhostLayer: layer });
    try {
      render();
      const halo = renderer.halos.get('lap');
      const clear = vi.spyOn(halo, 'clear');
      const instructions = halo.context.instructions;
      for (let index = 0; index < 120; index += 1) {
        ghost.x += 2;
        ghost.heading += 0.01;
        render();
      }
      expect(clear).not.toHaveBeenCalled();
      expect(halo.context.instructions).toBe(instructions);
      expect(halo.x).toBe(340);
      expect(halo.rotation).toBe(ghost.heading);
      expect(renderer.sprites.get('lap').x).toBe(340);
      expect(renderer.labels.get('lap').x).toBe(340);

      ghost.color = '#ff0000';
      render();
      expect(clear).toHaveBeenCalledTimes(1);
      ghost.opacity = 0.2;
      render();
      expect(clear).toHaveBeenCalledTimes(2);
      ghost.opacity = 0.8;
      render();
      expect(clear).toHaveBeenCalledTimes(3);
      ghost.opacity = 1;
      render();
      expect(clear).toHaveBeenCalledTimes(3);
      expect(renderer.sprites.get('lap').alpha).toBe(1);
      expect(renderer.labels.get('lap').alpha).toBe(1);

      ghost.visible = false;
      render();
      expect(halo.destroyed).toBe(true);
      expect(layer.children).toHaveLength(0);
      ghost.visible = true;
      render();
      expect(renderer.halos.get('lap')).not.toBe(halo);
      expect(renderer.halos.get('lap').context.instructions.length).toBeGreaterThan(0);
    } finally {
      renderer.destroy();
      layer.destroy({ children: true });
    }
  });

  test('child cleanup destroys nested display objects while preserving shared textures and sources', () => {
    const container = new Container();
    const group = new Container();
    const sprite = new Sprite(Texture.WHITE);
    const graphics = new Graphics().circle(0, 0, 3).fill(0xffffff);
    group.addChild(sprite, graphics);
    container.addChild(group);
    const textureDestroy = vi.spyOn(Texture.WHITE, 'destroy');
    const sourceDestroy = vi.spyOn(Texture.WHITE.source, 'destroy');
    try {
      destroyDisplayChildren(container);
      expect(container.children).toHaveLength(0);
      expect(group.destroyed).toBe(true);
      expect(sprite.destroyed).toBe(true);
      expect(graphics.destroyed).toBe(true);
      expect(textureDestroy).not.toHaveBeenCalled();
      expect(sourceDestroy).not.toHaveBeenCalled();
      expect(() => destroyDisplayChildren(container)).not.toThrow();
      expect(() => destroyDisplayChildren(null)).not.toThrow();
      expect(() => destroyDisplayChildren({})).not.toThrow();
    } finally {
      textureDestroy.mockRestore();
      sourceDestroy.mockRestore();
      container.destroy();
    }
  });
});
