import { describe, expect, test } from 'vitest';
import { renderTimingTower } from '../app/readouts/timingTowerRenderer.js';

class FakeDocument {
  createElement(tagName) {
    return new FakeElement(tagName, this);
  }
}

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName.toLowerCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.attributes = new Map();
    this.parentNode = null;
    this.className = '';
    this.textContent = '';
    this.style = {
      values: new Map(),
      setProperty: (name, value) => {
        this.style.values.set(name, String(value));
      },
    };
  }

  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parentNode = null;
    return child;
  }

  remove() {
    this.parentNode?.removeChild(this);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === 'class') this.className = String(value);
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  get innerHTML() {
    return this.children.map((child) => child.outerHTML).join('');
  }

  set innerHTML(value) {
    this.innerHTMLAssignments = (this.innerHTMLAssignments ?? 0) + 1;
    this.textContent = String(value);
    this.children.length = 0;
  }

  get outerHTML() {
    const attributes = [];
    if (this.className) attributes.push(`class="${this.className}"`);
    this.attributes.forEach((value, name) => {
      if (name !== 'class') attributes.push(`${name}="${value}"`);
    });
    if (this.style.values.size) {
      const style = [...this.style.values.entries()]
        .map(([name, value]) => `${name}: ${value}`)
        .join('; ');
      attributes.push(`style="${style}"`);
    }
    const body = `${this.textContent}${this.children.map((child) => child.outerHTML).join('')}`;
    return `<${this.tagName}${attributes.length ? ` ${attributes.join(' ')}` : ''}>${body}</${this.tagName}>`;
  }
}

function createTimingList() {
  const ownerDocument = new FakeDocument();
  const list = ownerDocument.createElement('ol');
  list.innerHTMLAssignments = 0;
  return list;
}

const drivers = [
  { id: 'alpha', name: 'Alpha Project', color: '#ff2d55', team: { icon: 'AP', color: '#00ff84' } },
  { id: 'bravo', name: 'Bravo Project', color: '#39a7ff', team: { icon: 'BP', color: '#ffd166' } },
];

describe('timing tower renderer', () => {
  test('reuses keyed row nodes instead of rebuilding innerHTML on DOM-capable lists', () => {
    const timingList = createTimingList();
    const driverById = new Map(drivers.map((driver) => [driver.id, driver]));
    const cars = [
      { id: 'alpha', rank: 1, code: 'ALP', timingCode: 'ALP', name: 'Alpha Project', color: '#ff2d55', tire: 'M' },
      { id: 'bravo', rank: 2, code: 'BRV', timingCode: 'BRV', name: 'Bravo Project', color: '#39a7ff', tire: 'H', intervalAheadSeconds: 1.234 },
    ];

    let lastTimingMarkup = renderTimingTower({
      timingList,
      cars,
      raceMode: 'green',
      penalties: [],
      driverById,
      selectedId: 'alpha',
      timingGapMode: 'interval',
      timingPenaltyBadgesEnabled: true,
      lastTimingMarkup: '',
    });
    const firstRows = [...timingList.children];
    const firstAlphaButton = firstRows[0].children[0];
    const firstBravoButton = firstRows[1].children[0];

    expect(timingList.innerHTMLAssignments).toBe(0);
    expect(timingList.innerHTML).toContain('ALP');
    expect(timingList.innerHTML).toContain('+1.234');

    cars[1] = { ...cars[1], intervalAheadSeconds: 1.5 };
    lastTimingMarkup = renderTimingTower({
      timingList,
      cars,
      raceMode: 'green',
      penalties: [],
      driverById,
      selectedId: 'bravo',
      timingGapMode: 'interval',
      timingPenaltyBadgesEnabled: true,
      lastTimingMarkup,
    });

    expect(timingList.innerHTMLAssignments).toBe(0);
    expect(timingList.children[0]).toBe(firstRows[0]);
    expect(timingList.children[1]).toBe(firstRows[1]);
    expect(timingList.children[0].children[0]).toBe(firstAlphaButton);
    expect(timingList.children[1].children[0]).toBe(firstBravoButton);
    expect(firstAlphaButton.className).not.toContain('is-selected');
    expect(firstBravoButton.className).toContain('is-selected');
    expect(timingList.innerHTML).toContain('+1.5');
  });

  test('removes stale DOM rows and penalty badges on keyed updates', () => {
    const timingList = createTimingList();
    const driverById = new Map(drivers.map((driver) => [driver.id, driver]));
    const cars = [
      { id: 'alpha', rank: 1, code: 'ALP', timingCode: 'ALP', name: 'Alpha Project', color: '#ff2d55', tire: 'M' },
      { id: 'bravo', rank: 2, code: 'BRV', timingCode: 'BRV', name: 'Bravo Project', color: '#39a7ff', tire: 'H', intervalAheadSeconds: 1.234 },
    ];

    renderTimingTower({
      timingList,
      cars,
      raceMode: 'green',
      penalties: [{ id: 'p1', driverId: 'alpha', penaltySeconds: 5, type: 'collision' }],
      driverById,
      selectedId: 'alpha',
      timingGapMode: 'interval',
      timingPenaltyBadgesEnabled: true,
      lastTimingMarkup: '',
    });
    const bravoRow = timingList.children[1];

    renderTimingTower({
      timingList,
      cars: [{ ...cars[1], rank: 1, intervalAheadSeconds: undefined }],
      raceMode: 'green',
      penalties: [],
      driverById,
      selectedId: 'bravo',
      timingGapMode: 'interval',
      timingPenaltyBadgesEnabled: true,
      lastTimingMarkup: '',
    });

    expect(timingList.innerHTMLAssignments).toBe(0);
    expect(timingList.children).toHaveLength(1);
    expect(timingList.children[0]).toBe(bravoRow);
    expect(timingList.innerHTML).toContain('BRV');
    expect(timingList.innerHTML).not.toContain('ALP');
    expect(timingList.innerHTML).not.toContain('timing-penalty-badge');
  });
});
