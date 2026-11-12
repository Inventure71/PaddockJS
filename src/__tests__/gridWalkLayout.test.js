import { describe, expect, test } from 'vitest';
import { GridWalkLayout } from '../app/gridWalk/gridWalkLayout.js';
import { GridWalkProjectBanner } from '../app/gridWalk/gridWalkProjectBanner.js';

describe('Grid Walk host coordinates', () => {
  test.each([1, 0.985, 0.7, 1.2])('measures the same scene inside a host scaled by %s', (scale) => {
    const layout = new GridWalkLayout({
      canvasHost: { clientWidth: 1120, clientHeight: 620,
        getBoundingClientRect: () => ({ top: 100, width: 1120 * scale, height: 620 * scale }) },
      element: { querySelector: () => ({ getBoundingClientRect: () => ({ bottom: 100 + 70 * scale }) }) },
    });
    const area = layout.measure(132);
    expect(area.left).toBe(16);
    expect(area.right).toBe(1104);
    expect(area.top).toBeCloseTo(82);
    expect(area.bottom).toBe(472);
  });

  test.each([1, 0.985, 0.7, 1.2])('reserves banner space in canvas coordinates at host scale %s', (scale) => {
    const banner = Object.create(GridWalkProjectBanner.prototype);
    banner.enabled = true;
    banner.element = { hidden: true, classList: { toggle() {} }, style: {},
      getBoundingClientRect: () => ({ height: 108 * scale }) };
    expect(banner.measure(1120, 620, scale)).toBeCloseTo(132);
    expect(banner.element.hidden).toBe(true);
  });
});
