import { describe, expect, test } from 'vitest';
import { packGridLabels } from '../app/gridWalk/gridWalkLabels.js';

function expectPacked(items, start, end) {
  const original = structuredClone(items);
  const packed = packGridLabels(items, start, end);
  expect(items).toEqual(original);
  expect(packed.map(({ id }) => id)).toEqual([...items].sort((a, b) => a.anchor - b.anchor).map(({ id }) => id));
  for (let index = 0; index < packed.length; index += 1) {
    const item = packed[index];
    expect(item.position).toBeGreaterThanOrEqual(start);
    expect(item.position + item.size).toBeLessThanOrEqual(end);
    if (index) expect(item.position - packed[index - 1].position - packed[index - 1].size).toBeGreaterThanOrEqual(8);
  }
  return packed;
}

describe('Grid Walk label lane packing', () => {
  test('empty lanes are safe and isolated labels stay anchored unless bounded by an edge', () => {
    expect(packGridLabels([], 20, 380)).toEqual([]);
    expect(expectPacked([{ id: 'center', anchor: 200, size: 80 }], 20, 380)[0].position).toBe(160);
    expect(expectPacked([{ id: 'left', anchor: -100, size: 80 }], 20, 380)[0].position).toBe(20);
    expect(expectPacked([{ id: 'right', anchor: 500, size: 80 }], 20, 380)[0].position).toBe(300);
  });

  test('variable sizes preserve spatial order and separate clustered anchors at either boundary', () => {
    for (const anchors of [[10, 10, 12, 14], [360, 362, 364, 380], [20, 23, 375, 380]]) {
      expectPacked([
        { id: 'last', anchor: anchors[3], size: 87 },
        { id: 'second', anchor: anchors[1], size: 74 },
        { id: 'first', anchor: anchors[0], size: 66 },
        { id: 'third', anchor: anchors[2], size: 91 },
      ], 20, 380);
    }
  });

  test('a completely occupied feasible lane still fits every label and its gaps', () => {
    const items = [94, 40, 71, 55].map((size, index) => ({ id: String(index), anchor: 140 + index, size }));
    const start = 30;
    const end = start + items.reduce((sum, item) => sum + item.size, 0) + 8 * (items.length - 1);
    const packed = expectPacked(items, start, end);
    expect(packed[0].position).toBe(start);
    expect(packed.at(-1).position + packed.at(-1).size).toBe(end);
  });

  test('fractional lane dimensions keep separated labels within bounds', () => {
    expectPacked([
      { id: 'a', anchor: 40.25, size: 62.5 },
      { id: 'b', anchor: 43.75, size: 81.25 },
      { id: 'c', anchor: 185.5, size: 71.75 },
    ], 16.25, 300.5);
  });
});
