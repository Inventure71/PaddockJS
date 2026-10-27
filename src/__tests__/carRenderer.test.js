import { describe, expect, test, vi } from 'vitest';
import { Container, Texture } from 'pixi.js';
import { CarRenderer } from '../app/rendering/carRenderer.js';

describe('car renderer', () => {
  test('staging snaps to the original pose while ordinary racing keeps heading smoothing', () => {
    const renderer = new CarRenderer({ carSprites: new Map(), carHitAreas: new Map(), serviceCountdownLabels: new Map() });
    const layer = new Container();
    const textures = { car: Texture.WHITE };
    renderer.createCars({ drivers: [{ id: 'entry', color: '#ff0000' }], textures, carLayer: layer });
    const sprite = renderer.carSprites.get('entry');
    sprite.currentRotation = 1.5;
    const snapshot = { cars: [{ id: 'entry', x: 20, y: 30, heading: 0.2, color: '#ff0000' }],
      raceControl: { mode: 'green' }, safetyCar: { deployed: false } };
    renderer.renderCars(snapshot, { textures, carLayer: layer, snapToPose: true });
    expect([sprite.x, sprite.y, sprite.rotation]).toEqual([20, 30, 0.2]);
    renderer.renderCars({ ...snapshot, cars: [{ ...snapshot.cars[0], heading: 1.2 }] }, { textures, carLayer: layer });
    expect(sprite.rotation).toBeGreaterThan(0.2);
    expect(sprite.rotation).toBeLessThan(1.2);
    layer.destroy({ children: true });
  });

  test('draws non-colliding marker geometry once and only updates display state per frame', () => {
    const renderer = new CarRenderer({
      carSprites: new Map(),
      carHitAreas: new Map(),
      serviceCountdownLabels: new Map(),
      onSelectCar: null,
    });
    const marker = renderer.createNonCollidingMarker();
    renderer.nonCollidingMarkers.set('model-a', marker);

    const bounds = marker.getLocalBounds();
    expect(bounds.width).toBeGreaterThan(0);
    expect(bounds.height).toBeGreaterThan(0);

    const drawingSpies = ['clear', 'ellipse', 'moveTo', 'lineTo', 'stroke']
      .map((method) => vi.spyOn(marker, method));

    renderer.renderNonCollidingMarker({
      id: 'model-a',
      x: 100,
      y: 120,
      heading: 0.35,
      interaction: { collidable: false },
    });
    renderer.renderNonCollidingMarker({
      id: 'model-a',
      x: 140,
      y: 160,
      heading: -0.25,
      interaction: { collidable: false },
    });

    expect(marker).toEqual(expect.objectContaining({
      visible: true,
      x: 140,
      y: 160,
      rotation: -0.25,
      eventMode: 'none',
      interactionVisualRole: 'non-colliding-marker',
    }));
    drawingSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());

    renderer.renderNonCollidingMarker({
      id: 'model-a',
      interaction: { collidable: true },
    });
    expect(marker.visible).toBe(false);
  });
});
