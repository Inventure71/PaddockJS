import { Graphics, Sprite, Text, Texture } from 'pixi.js';
import { CAR_WORLD_LENGTH } from '../camera/cameraConstants.js';
import { VEHICLE_GEOMETRY } from '../../simulation/vehicleGeometry.js';
import { colorToTint, smoothAngle } from './displayUtils.js';

const CAR_WORLD_WIDTH = VEHICLE_GEOMETRY.visualWidth;

export class ReplayGhostRenderer {
  constructor() {
    this.sprites = new Map();
    this.labels = new Map();
    this.halos = new Map();
  }

  render(snapshot, { textures, replayGhostLayer }) {
    if (!replayGhostLayer) return;
    const visibleGhosts = (snapshot.replayGhosts ?? []).filter((ghost) => ghost.visible !== false);
    const visibleIds = new Set(visibleGhosts.map((ghost) => ghost.id));
    [...this.sprites.keys()].forEach((id) => {
      if (visibleIds.has(id)) return;
      this.destroyGhost(id);
    });

    visibleGhosts.forEach((ghost) => {
      const halo = this.ensureHalo(ghost, replayGhostLayer);
      halo.x = ghost.x;
      halo.y = ghost.y;
      halo.rotation = ghost.heading;
      this.drawHalo(halo, ghost);

      const sprite = this.ensureSprite(ghost, textures, replayGhostLayer);
      sprite.x = ghost.x;
      sprite.y = ghost.y;
      sprite.currentRotation = smoothAngle(sprite.currentRotation, ghost.heading, 0.24);
      sprite.rotation = sprite.currentRotation;
      sprite.alpha = ghost.opacity;
      sprite.tint = colorToTint(ghost.color);

      const label = this.ensureLabel(ghost, replayGhostLayer);
      label.text = ghost.label;
      label.x = ghost.x;
      label.y = ghost.y - CAR_WORLD_WIDTH * 1.15;
      label.alpha = Math.min(1, ghost.opacity + 0.2);
      label.visible = Boolean(ghost.label);
    });
  }

  destroy() {
    [...this.sprites.keys()].forEach((id) => this.destroyGhost(id));
  }

  ensureHalo(ghost, replayGhostLayer) {
    let halo = this.halos.get(ghost.id);
    if (halo) return halo;
    halo = new Graphics();
    halo.eventMode = 'none';
    halo.ghostVisualRole = 'replay-halo';
    this.halos.set(ghost.id, halo);
    replayGhostLayer.addChild(halo);
    return halo;
  }

  ensureSprite(ghost, textures, replayGhostLayer) {
    let sprite = this.sprites.get(ghost.id);
    if (sprite) return sprite;
    const texture = textures.car ?? Texture.WHITE;
    sprite = new Sprite(texture);
    sprite.anchor.set(0.5);
    sprite.baseScale = Math.min(
      CAR_WORLD_LENGTH / Math.max(texture.width, 1),
      CAR_WORLD_WIDTH / Math.max(texture.height, 1),
    );
    sprite.scale.set(sprite.baseScale);
    sprite.eventMode = 'none';
    sprite.currentRotation = ghost.heading;
    this.sprites.set(ghost.id, sprite);
    replayGhostLayer.addChild(sprite);
    return sprite;
  }

  ensureLabel(ghost, replayGhostLayer) {
    let label = this.labels.get(ghost.id);
    if (label) return label;
    label = new Text({
      text: ghost.label,
      style: {
        fill: 0xffffff,
        fontFamily: 'Arial, sans-serif',
        fontSize: 18,
        fontWeight: '800',
        align: 'center',
        stroke: { color: 0x000000, width: 3 },
      },
    });
    label.anchor.set(0.5);
    label.resolution = 2;
    this.labels.set(ghost.id, label);
    replayGhostLayer.addChild(label);
    return label;
  }

  destroyGhost(id) {
    this.halos.get(id)?.destroy?.();
    this.sprites.get(id)?.destroy?.();
    this.labels.get(id)?.destroy?.();
    this.halos.delete(id);
    this.sprites.delete(id);
    this.labels.delete(id);
  }

  drawHalo(halo, ghost) {
    const tint = colorToTint(ghost.color);
    const alpha = Math.max(0.18, Math.min(0.55, ghost.opacity + 0.16));
    halo.clear();
    halo
      .ellipse(0, 0, CAR_WORLD_LENGTH * 0.72, CAR_WORLD_WIDTH * 1.25)
      .fill({ color: tint, alpha: Math.min(0.14, alpha * 0.28) })
      .stroke({ width: 5, color: tint, alpha });
    halo
      .moveTo(CAR_WORLD_LENGTH * 0.55, 0)
      .lineTo(CAR_WORLD_LENGTH * 0.92, 0)
      .stroke({ width: 3, color: 0xffffff, alpha: Math.min(0.72, alpha + 0.14) });
  }
}
