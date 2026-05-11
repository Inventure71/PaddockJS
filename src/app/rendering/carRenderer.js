import { Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import { metersToSimUnits } from '../../simulation/units.js';
import { VEHICLE_GEOMETRY } from '../../simulation/vehicleGeometry.js';
import { CAR_WORLD_LENGTH } from '../camera/cameraConstants.js';
import { colorToTint, smoothAngle } from './displayUtils.js';

const CAR_WORLD_WIDTH = VEHICLE_GEOMETRY.visualWidth;
const TEMP_RENDER_RAW_CAR_GEOMETRY = false;
const NON_COLLIDING_MARKER_COLOR = 0x38bdf8;
const SAFETY_CAR_WORLD_LENGTH = metersToSimUnits(5.3);
const SAFETY_CAR_WORLD_WIDTH = metersToSimUnits(2.1);
const SERVICE_COUNTDOWN_LABEL_STYLES = {
  penalty: {
    background: 0x110b0b,
    stroke: 0xff2d55,
    fill: 0xffffff,
  },
  pit: {
    background: 0x171305,
    stroke: 0xffd166,
    fill: 0xfff2b0,
  },
};

export class CarRenderer {
  constructor({ carSprites, carHitAreas, serviceCountdownLabels, onSelectCar }) {
    this.carSprites = carSprites;
    this.carHitAreas = carHitAreas;
    this.serviceCountdownLabels = serviceCountdownLabels;
    this.onSelectCar = onSelectCar;
    this.safetySprite = null;
    this.nonCollidingMarkers = new Map();
  }

  createCars({ drivers, textures, carLayer }) {
    const texture = textures.car ?? Texture.WHITE;
    const baseScale = Math.min(
      CAR_WORLD_LENGTH / Math.max(texture.width, 1),
      CAR_WORLD_WIDTH / Math.max(texture.height, 1),
    );

    this.carSprites.forEach((sprite) => sprite.destroy());
    this.carHitAreas.forEach((hit) => hit.destroy());
    this.serviceCountdownLabels.forEach((label) => label.destroy({ children: true }));
    this.nonCollidingMarkers.forEach((marker) => marker.destroy());
    this.carSprites.clear();
    this.carHitAreas.clear();
    this.serviceCountdownLabels.clear();
    this.nonCollidingMarkers.clear();

    if (this.safetySprite) {
      this.safetySprite.destroy();
      this.safetySprite = null;
    }

    drivers.forEach((driver) => {
      const sprite = TEMP_RENDER_RAW_CAR_GEOMETRY
        ? this.createRawCarGeometryGraphic(driver)
        : new Sprite(texture);
      if (!TEMP_RENDER_RAW_CAR_GEOMETRY) {
        sprite.anchor.set(0.5);
        sprite.baseScale = baseScale;
        sprite.scale.set(baseScale);
      } else {
        sprite.baseScale = 1;
      }

      const marker = this.createNonCollidingMarker();
      this.nonCollidingMarkers.set(driver.id, marker);
      carLayer.addChild(marker);

      sprite.tint = TEMP_RENDER_RAW_CAR_GEOMETRY ? 0xffffff : colorToTint(driver.color);
      sprite.eventMode = 'static';
      sprite.cursor = 'pointer';
      sprite.on('pointerdown', () => {
        this.onSelectCar?.(driver.id);
      });
      this.carSprites.set(driver.id, sprite);
      carLayer.addChild(sprite);

      const hit = new Graphics();
      hit.circle(0, 0, 24).fill({ color: 0xffffff, alpha: 0.001 });
      hit.eventMode = 'static';
      hit.cursor = 'pointer';
      hit.on('pointerdown', () => {
        this.onSelectCar?.(driver.id);
      });
      this.carHitAreas.set(driver.id, hit);
      carLayer.addChild(hit);

      const serviceLabel = this.createServiceCountdownLabel();
      serviceLabel.visible = false;
      this.serviceCountdownLabels.set(driver.id, serviceLabel);
      carLayer.addChild(serviceLabel);
    });
  }

  createRawCarGeometryGraphic(driver) {
    const graphic = new Graphics();
    const tint = colorToTint(driver.color);
    const wheelLong = VEHICLE_GEOMETRY.wheelLongitudinalOffset;
    const wheelLat = VEHICLE_GEOMETRY.wheelLateralOffset;
    const wheelLength = VEHICLE_GEOMETRY.wheelLength;
    const wheelWidth = VEHICLE_GEOMETRY.wheelWidth;

    graphic
      .rect(
        -VEHICLE_GEOMETRY.bodyLength / 2,
        -VEHICLE_GEOMETRY.bodyWidth / 2,
        VEHICLE_GEOMETRY.bodyLength,
        VEHICLE_GEOMETRY.bodyWidth,
      )
      .fill({ color: tint, alpha: 0.42 })
      .stroke({ width: 2.2, color: 0xf8fafc, alpha: 0.95 });

    [
      [wheelLong, -wheelLat],
      [wheelLong, wheelLat],
      [-wheelLong, -wheelLat],
      [-wheelLong, wheelLat],
    ].forEach(([x, y]) => {
      graphic
        .rect(x - wheelLength / 2, y - wheelWidth / 2, wheelLength, wheelWidth)
        .fill({ color: 0x111827, alpha: 0.95 })
        .stroke({ width: 1.5, color: tint, alpha: 1 });
    });

    const noseMarkerLength = metersToSimUnits(0.75);
    graphic
      .moveTo(VEHICLE_GEOMETRY.bodyLength / 2 - noseMarkerLength, 0)
      .lineTo(VEHICLE_GEOMETRY.bodyLength / 2 + noseMarkerLength, 0)
      .stroke({ width: 2, color: 0xf1c65b, alpha: 0.95 });
    return graphic;
  }

  createNonCollidingMarker() {
    const marker = new Graphics();
    marker.visible = false;
    marker.eventMode = 'none';
    marker.interactionVisualRole = 'non-colliding-marker';
    return marker;
  }

  renderNonCollidingMarker(car) {
    const marker = this.nonCollidingMarkers.get(car.id);
    if (!marker) return;
    const visible = car.interaction?.collidable === false;
    if (marker.visible !== visible) marker.visible = visible;
    if (!visible) return;

    if (marker.x !== car.x) marker.x = car.x;
    if (marker.y !== car.y) marker.y = car.y;
    if (marker.rotation !== car.heading) marker.rotation = car.heading;

    marker.clear();
    const length = CAR_WORLD_LENGTH * 0.82;
    const width = CAR_WORLD_WIDTH * 1.32;
    const halfLength = length / 2;
    const halfWidth = width / 2;
    const segment = CAR_WORLD_LENGTH * 0.22;
    const alpha = 0.86;
    marker.ellipse(0, 0, halfLength, halfWidth)
      .stroke({ width: 2.5, color: NON_COLLIDING_MARKER_COLOR, alpha: 0.36 });
    [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ].forEach(([longitudinal, lateral]) => {
      marker
        .moveTo(longitudinal * halfLength, lateral * (halfWidth - segment))
        .lineTo(longitudinal * halfLength, lateral * halfWidth)
        .lineTo(longitudinal * (halfLength - segment), lateral * halfWidth)
        .stroke({ width: 4, color: NON_COLLIDING_MARKER_COLOR, alpha });
    });
  }

  createServiceCountdownLabel() {
    const container = new Container();
    const background = new Graphics();
    const text = new Text({
      text: '0s',
      style: {
        fill: 0xffffff,
        fontFamily: 'Arial, sans-serif',
        fontSize: 16,
        fontWeight: '900',
        align: 'center',
      },
    });
    text.anchor.set(0.5);
    text.resolution = 2;
    container.addChild(background, text);
    container.labelBackground = background;
    container.labelText = text;
    this.applyServiceCountdownTone(container, 'pit');
    return container;
  }

  applyServiceCountdownTone(label, tone) {
    const style = SERVICE_COUNTDOWN_LABEL_STYLES[tone] ?? SERVICE_COUNTDOWN_LABEL_STYLES.pit;
    if (label.serviceTone === tone) return;
    label.labelBackground?.clear?.();
    label.labelBackground?.roundRect(-28, -14, 56, 28, 4)
      .fill({ color: style.background, alpha: 0.92 })
      .stroke({ width: 2, color: style.stroke, alpha: 0.95 });
    if (label.labelText?.style) label.labelText.style.fill = style.fill;
    label.serviceTone = tone;
  }

  renderCars(snapshot, { textures, carLayer }) {
    snapshot.cars.forEach((car) => {
      const sprite = this.carSprites.get(car.id);
      const hit = this.carHitAreas.get(car.id);
      if (!sprite || !hit) return;
      if (sprite.x !== car.x) sprite.x = car.x;
      if (sprite.y !== car.y) sprite.y = car.y;
      if (TEMP_RENDER_RAW_CAR_GEOMETRY) {
        sprite.currentRotation = car.heading;
        if (sprite.rotation !== car.heading) sprite.rotation = car.heading;
      } else {
        sprite.currentRotation = smoothAngle(sprite.currentRotation, car.heading, 0.24);
        if (sprite.rotation !== sprite.currentRotation) sprite.rotation = sprite.currentRotation;
      }
      const alpha = snapshot.raceControl.mode === 'safety-car' ? 0.82 : 1;
      if (sprite.alpha !== alpha) sprite.alpha = alpha;
      if (sprite.lastRenderedScale !== sprite.baseScale) {
        sprite.scale.set(sprite.baseScale);
        sprite.lastRenderedScale = sprite.baseScale;
      }
      const tint = TEMP_RENDER_RAW_CAR_GEOMETRY ? 0xffffff : colorToTint(car.color);
      if (sprite.tint !== tint) sprite.tint = tint;
      if (hit.x !== car.x) hit.x = car.x;
      if (hit.y !== car.y) hit.y = car.y;
      this.renderNonCollidingMarker(car);
      this.renderServiceCountdownLabel(car);
    });

    if (!this.safetySprite && snapshot.safetyCar.deployed) {
      const texture = textures.safetyCar ?? Texture.WHITE;
      this.safetySprite = new Sprite(texture);
      this.safetySprite.anchor.set(0.5);
      this.safetySprite.baseScale = Math.min(
        SAFETY_CAR_WORLD_LENGTH / Math.max(texture.width, 1),
        SAFETY_CAR_WORLD_WIDTH / Math.max(texture.height, 1),
      );
      this.safetySprite.scale.set(this.safetySprite.baseScale);
      carLayer.addChild(this.safetySprite);
    }

    if (this.safetySprite) {
      if (this.safetySprite.visible !== snapshot.safetyCar.deployed) {
        this.safetySprite.visible = snapshot.safetyCar.deployed;
      }
      if (this.safetySprite.x !== snapshot.safetyCar.x) this.safetySprite.x = snapshot.safetyCar.x;
      if (this.safetySprite.y !== snapshot.safetyCar.y) this.safetySprite.y = snapshot.safetyCar.y;
      if (this.safetySprite.rotation !== snapshot.safetyCar.heading) {
        this.safetySprite.rotation = snapshot.safetyCar.heading;
      }
    }
  }

  renderServiceCountdownLabel(car) {
    const label = this.serviceCountdownLabels.get(car.id);
    if (!label) return;
    const penaltyRemaining = Number(car.pitStop?.penaltyServiceRemainingSeconds);
    const serviceRemaining = Number(car.pitStop?.serviceRemainingSeconds);
    const isPenalty = car.pitStop?.phase === 'penalty' && Number.isFinite(penaltyRemaining) && penaltyRemaining > 0;
    const isPitService = car.pitStop?.phase === 'service' && Number.isFinite(serviceRemaining) && serviceRemaining > 0;
    const visible = isPenalty || isPitService;
    label.visible = visible;
    if (!visible) return;
    const tone = isPenalty ? 'penalty' : 'pit';
    const remaining = isPenalty ? penaltyRemaining : serviceRemaining;
    if (label.x !== car.x) label.x = car.x;
    const labelY = car.y - 48;
    if (label.y !== labelY) label.y = labelY;
    if (label.rotation !== 0) label.rotation = 0;
    this.applyServiceCountdownTone(label, tone);
    if (label.labelText) {
      const nextText = `${tone === 'penalty' ? '+' : ''}${Math.ceil(remaining)}s`;
      if (label.labelText.text !== nextText) label.labelText.text = nextText;
    }
  }
}
