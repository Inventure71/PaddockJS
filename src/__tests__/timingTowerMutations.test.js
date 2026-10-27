import { describe, expect, test } from 'vitest';
import { renderTimingTower } from '../app/readouts/timingTowerRenderer.js';

class MutationDocument {
  mutations = [];
  activeElement = null;
  createElement(tag) { return new MutationElement(tag, this); }
}

class MutationElement {
  constructor(tag, document) {
    this.tagName = tag;
    this.ownerDocument = document;
    this.children = [];
    this.attributes = new Map();
    this.parentNode = null;
    this.classValue = '';
    this.textValue = '';
    const values = new Map();
    this.style = {
      getPropertyValue: (name) => values.get(name) ?? '',
      setProperty: (name, value) => {
        values.set(name, String(value));
        document.mutations.push({ node: this, kind: 'style', name, value: String(value) });
      },
    };
  }
  get className() { return this.classValue; }
  set className(value) {
    this.classValue = value;
    this.ownerDocument.mutations.push({ node: this, kind: 'class', value });
  }
  get textContent() { return this.textValue; }
  set textContent(value) {
    this.textValue = value;
    this.ownerDocument.mutations.push({ node: this, kind: 'text', value });
  }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    this.ownerDocument.mutations.push({ node: this, kind: 'attribute', name, value: String(value) });
  }
  appendChild(child) { return this.insertAt(child, this.children.length); }
  insertBefore(child, reference) {
    return this.insertAt(child, reference ? this.children.indexOf(reference) : this.children.length);
  }
  insertAt(child, index) {
    const oldIndex = child.parentNode === this ? this.children.indexOf(child) : -1;
    if (child.parentNode) child.parentNode.removeChild(child);
    if (oldIndex >= 0 && oldIndex < index) index -= 1;
    this.children.splice(index, 0, child);
    child.parentNode = this;
    this.ownerDocument.mutations.push({ node: this, kind: 'insert', child });
    return child;
  }
  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index < 0) throw new Error('Child not found');
    this.children.splice(index, 1);
    for (let active = this.ownerDocument.activeElement; active; active = active.parentNode) {
      if (active === child) { this.ownerDocument.activeElement = null; break; }
    }
    child.parentNode = null;
    this.ownerDocument.mutations.push({ node: this, kind: 'remove', child });
    return child;
  }
  remove() { this.parentNode?.removeChild(this); }
  focus() { this.ownerDocument.activeElement = this; }
}

function fixture({ appendOnly = false } = {}) {
  const document = new MutationDocument();
  const list = document.createElement('ol');
  if (appendOnly) list.insertBefore = undefined;
  const cars = [
    { id: 'alpha', rank: 1, code: 'ALP', name: 'Alpha', color: '#ff2d55', tire: 'M' },
    { id: 'bravo', rank: 2, code: 'BRV', name: 'Bravo', color: '#39a7ff', tire: 'H', intervalAheadSeconds: 1.234 },
    { id: 'charlie', rank: 3, code: 'CHR', name: 'Charlie', color: '#ffd166', tire: 'S', intervalAheadSeconds: 2 },
  ];
  const config = {
    timingList: list, cars, raceMode: 'green', driverById: new Map(),
    selectedId: 'alpha', timingGapMode: 'interval', timingPenaltyBadgesEnabled: true,
  };
  let lastTimingMarkup = '';
  const render = (overrides = {}) => {
    lastTimingMarkup = renderTimingTower({ ...config, ...overrides, lastTimingMarkup });
  };
  render();
  const view = (id) => list.__paddockTimingRowViews.get(id);
  document.mutations.length = 0;
  return { document, list, cars, render, view };
}

describe('timing tower DOM mutation boundaries', () => {
  test.each([false, true])('gap-only updates preserve focus and avoid child moves (append-only: %s)', (appendOnly) => {
    const { document, list, cars, render, view } = fixture({ appendOnly });
    const button = view('bravo').button;
    const gap = view('bravo').gap;
    const order = [...list.children];
    button.focus();
    cars[1].intervalAheadSeconds = 1.5;
    render();
    expect(document.mutations).toHaveLength(1);
    expect(document.mutations[0].node).toBe(gap);
    expect(document.mutations[0].kind).toBe('text');
    expect(document.mutations[0].value).toBe('+1.500');
    expect(list.children).toEqual(order);
    expect(document.activeElement).toBe(button);
    document.mutations.length = 0;
    render();
    expect(document.mutations).toEqual([]);
    expect(document.activeElement).toBe(button);
  });

  test.each([false, true])('reconciles reordered, added and removed rows without losing keyed identities (append-only: %s)', (appendOnly) => {
    const { document, list, cars, render, view } = fixture({ appendOnly });
    const alpha = view('alpha');
    const bravo = view('bravo');
    const charlie = view('charlie');
    render({ cars: [cars[1], cars[2], cars[0]] });
    expect(list.children).toEqual([bravo.item, charlie.item, alpha.item]);
    expect(document.mutations.filter((change) => change.kind === 'text')).toEqual([]);
    const delta = { id: 'delta', rank: 4, code: 'DLT', name: 'Delta', color: '#00ff84', tire: 'M' };
    render({ cars: [delta, cars[2], cars[1]] });
    expect(list.children).toEqual([view('delta').item, charlie.item, bravo.item]);
    expect(list.__paddockTimingRowViews.has('alpha')).toBe(false);
    expect(alpha.item.parentNode).toBe(null);
    document.mutations.length = 0;
    render({ cars: [delta, cars[1]] });
    expect(list.children).toEqual([view('delta').item, bravo.item]);
    expect(document.mutations.filter((change) => change.kind === 'insert')).toEqual([]);
    expect(document.mutations.filter((change) => change.kind === 'remove')).toHaveLength(1);
  });

  test('updates color, title, selection, tire and penalty appearance without moving rows', () => {
    const { document, list, cars, render, view } = fixture();
    cars[1] = {
      ...cars[1], name: 'Bravo revised', color: '#00ff84', tire: 'S',
      timingCode: 'NEW', team: { icon: 'BP', color: '#ff0000' },
    };
    const penalties = [{ id: 'p1', driverId: 'bravo', penaltySeconds: 5, type: 'collision' }];
    render({ penalties, selectedId: 'bravo' });
    const bravo = view('bravo');
    expect(bravo.button.getAttribute('aria-label')).toBe('Select Bravo revised');
    expect(bravo.name.getAttribute('title')).toBe('Bravo revised');
    expect(bravo.button.style.getPropertyValue('--driver-color')).toBe('#00ff84');
    expect(bravo.icon.style.getPropertyValue('--team-color')).toBe('#ff0000');
    expect(bravo.icon.textContent).toBe('BP');
    expect(bravo.code.textContent).toBe('NEW');
    expect(bravo.button.className).toBe('timing-row is-selected ');
    expect(bravo.tire.className).toBe('timing-tire timing-tire--s');
    expect(bravo.tire.textContent).toBe('S');
    expect(bravo.penaltyBadge.getAttribute('title')).toBe('Penalty: 5s collision');
    expect(document.mutations.filter((change) => change.node === list && change.kind === 'insert')).toEqual([]);
    const badge = bravo.penaltyBadge;
    document.mutations.length = 0;
    render({ penalties, selectedId: 'bravo' });
    expect(document.mutations).toEqual([]);
    penalties[0].penaltySeconds = 10;
    render({ penalties, selectedId: 'bravo' });
    expect(bravo.penaltyBadge).toBe(badge);
    expect(document.mutations.map(({ kind, name, value }) => ({ kind, name, value }))).toEqual([
      { kind: 'attribute', name: 'aria-label', value: 'Penalty: 10s collision' },
      { kind: 'attribute', name: 'title', value: 'Penalty: 10s collision' },
    ]);
    document.mutations.length = 0;
    render({ penalties: [], selectedId: 'bravo' });
    expect(bravo.penaltyBadge).toBe(null);
    expect(document.mutations).toEqual([{ node: bravo.name, kind: 'remove', child: badge }]);
  });

  test('preserves DOM string coercion and guarded style-attribute fallback', () => {
    const { document, cars, render, view } = fixture();
    const bravo = view('bravo');
    bravo.button.style = undefined;
    bravo.icon.style = undefined;
    cars[1] = { ...cars[1], name: undefined, rank: null, code: undefined };
    render();
    expect(bravo.position.textContent).toBe('null');
    expect(bravo.name.getAttribute('title')).toBe('undefined');
    expect(bravo.button.getAttribute('aria-label')).toBe('Select undefined');
    expect(bravo.code.textContent).toBe('');
    expect(bravo.button.getAttribute('style')).toBe('--driver-color: #39a7ff');
    document.mutations.length = 0;
    render();
    expect(document.mutations).toEqual([]);
  });
});
