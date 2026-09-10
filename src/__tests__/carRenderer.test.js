import { describe, expect, test, vi } from 'vitest';
import { CarRenderer } from '../app/rendering/carRenderer.js';

describe('car renderer', () => {
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
