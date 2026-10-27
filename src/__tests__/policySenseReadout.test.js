import { afterEach, expect, test, vi } from 'vitest';
import { renderPolicySenses } from '../../local-preview/src/policyRunner/senseReadout.js';

function readout() {
  const nodes = [];
  const createElement = (tag) => {
    const node = { tag, children: [], append(...children) { this.children.push(...children); }, replaceChildren(...children) { this.children = children; } };
    nodes.push(node);
    return node;
  };
  vi.stubGlobal('document', { createElement });
  const root = createElement('main');
  return { root, values: () => nodes.filter((node) => node.tag === 'dd').map((node) => node.textContent), messages: () => nodes.map((node) => node.textContent).filter(Boolean) };
}

afterEach(() => vi.unstubAllGlobals());

test('missing observation clears stale senses and shows the selection prompt', () => {
  const { root, messages } = readout();
  root.append({ textContent: 'stale driver' });
  renderPolicySenses(root, null);
  expect(root.children).toHaveLength(2);
  expect(messages()).toContain('Select a controlled car to show its active senses.');
});

test('vector-only observation displays metadata without inventing object senses', () => {
  const { root, values, messages } = readout();
  renderPolicySenses(root, { vector: new Float32Array(12), schema: [] }, { debugStateFor: () => ({ memoryBin: 7, memoryWrites: 0 }) }, 'alpha', 'advanced');
  expect(values()).toEqual(['compact-vector', '12 values', '0 fields', 'vector-only', 'advanced', '7', '0']);
  expect(messages()).not.toContain('Car body');
  expect(root.children).toHaveLength(2);
});

test('physical readout formats exactly the active observation and its detected ray channels', () => {
  const { root, values, messages } = readout();
  renderPolicySenses(root, { object: {
    profile: 'physical-driver', self: { speedKph: 203.5, throttle: 0.63, brake: 0.04 },
    nearbyCars: [{ id: 'rival', relativeForwardMeters: 10.2, relativeRightMeters: 2, relativeSpeedKph: -5, closingRateMetersPerSecond: 6.7, leftOverlap: true }],
    rays: [{ id: 'front', angleDegrees: 0, track: { hit: true, distanceMeters: 13.123456, surface: 'track' }, car: { hit: false } }],
  } }, null, 'alpha', 'advanced');
  expect(values()).toContain('track, car');
  expect(values()).toContain('204 kph');
  expect(values()).toContain('63%');
  expect(values()).toContain('4%');
  expect(values().join(' ')).toContain('6.70 m/s closing');
  expect(values().join(' ')).toContain('edge 13.1 m track');
  expect(values().join(' ')).not.toContain('13.123456');
  expect(messages()).toContain('Opponent radar');
  expect(root.children.length).toBeGreaterThan(2);
});
