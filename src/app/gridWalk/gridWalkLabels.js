import { projectGridPoint } from './gridWalkCamera.js';

const GAP = 8;

// Pack a row/column as a group. Independent edge clamping stacks labels at the
// viewport boundary; packing keeps their order and gives every box real space.
export function packGridLabels(items, start, end) {
  const ordered = [...items].sort((a, b) => a.anchor - b.anchor);
  if (!ordered.length) return [];
  let cursor = start;
  const packed = ordered.map((item) => {
    const position = Math.max(cursor, Math.min(end - item.size, item.anchor - item.size / 2));
    cursor = position + item.size + GAP;
    return { ...item, position };
  });
  cursor = end;
  for (let index = packed.length - 1; index >= 0; index -= 1) {
    const item = packed[index];
    item.position = Math.min(item.position, cursor - item.size);
    cursor = item.position - GAP;
  }
  return packed;
}

export class GridWalkLabels {
  constructor(element, cars, onSelect, signal) {
    this.element = element;
    this.cars = new Map(cars.map((car) => [car.id, car]));
    this.buttons = [...element.querySelectorAll('[data-grid-entry]')];
    this.lines = new Map([...element.querySelectorAll('[data-grid-connector]')].map((line) => [line.dataset.gridConnector, line]));
    element.querySelector('[data-grid-labels]').addEventListener('click', (event) => {
      const button = event.target.closest('[data-grid-entry]');
      if (button) onSelect(button.dataset.gridEntry);
    }, { signal });
  }

  update(frame, selectedId, fallback) {
    const horizontal = frame.orientation === 'horizontal';
    const { area } = frame;
    const length = horizontal ? area.right - area.left : area.bottom - area.top;
    const middle = horizontal ? (area.top + area.bottom) / 2 : (area.left + area.right) / 2;
    const focused = this.buttons.find((button) => button === this.element.ownerDocument.activeElement);
    const candidates = [];
    for (const button of this.buttons) {
      const id = button.dataset.gridEntry;
      button.hidden = !frame.visibleIds.includes(id);
      button.setAttribute('aria-pressed', String(id === selectedId));
      this.lines.get(id).toggleAttribute('hidden', button.hidden);
      if (!button.hidden) {
        const car = this.cars.get(id);
        const point = projectGridPoint(frame, car);
        candidates.push({ button, id, point, side: car.gridOffset < 0 ? -1 : 1,
          anchor: horizontal ? point.x : point.y });
      }
    }
    for (const side of [-1, 1]) {
      let lane = candidates.filter((item) => item.side === side);
      const width = horizontal ? Math.min(180, Math.max(112, (length - GAP * (lane.length - 1)) / Math.max(1, lane.length)))
        : Math.min(128, (area.right - area.left - GAP) / 2);
      for (const item of lane) {
        item.button.style.width = `${width}px`;
        item.size = horizontal ? width : item.button.offsetHeight;
      }
      // Keep text readable when more cars are visible than the labels can fit.
      // The choice depends on camera geometry, never the selected entry.
      const center = horizontal ? (area.left + area.right) / 2 : (area.top + area.bottom) / 2;
      while (lane.reduce((sum, item) => sum + item.size, 0) + GAP * (lane.length - 1) > length) {
        const farthest = lane.reduce((a, b) => Math.abs(a.anchor - center) > Math.abs(b.anchor - center) ? a : b);
        farthest.button.hidden = true;
        this.lines.get(farthest.id).setAttribute('hidden', '');
        lane = lane.filter((item) => item !== farthest);
      }
      for (const item of packGridLabels(lane, horizontal ? area.left : area.top, horizontal ? area.right : area.bottom)) {
        const height = item.button.offsetHeight;
        const crossSize = horizontal ? height : width;
        const crossStart = horizontal ? area.top : area.left;
        const crossEnd = horizontal ? area.bottom : area.right;
        const minCross = side < 0 ? crossStart : middle + GAP / 2;
        const maxCross = side < 0 ? middle - GAP / 2 : crossEnd;
        if (crossSize > maxCross - minCross) {
          item.button.hidden = true;
          this.lines.get(item.id).setAttribute('hidden', '');
          continue;
        }
        const desired = (horizontal ? item.point.y : item.point.x) + side * (horizontal ? 55 : 80) - crossSize / 2;
        const cross = Math.max(minCross, Math.min(maxCross - crossSize, desired));
        const x = horizontal ? item.position : cross;
        const y = horizontal ? cross : item.position;
        item.button.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px)`;
        const line = this.lines.get(item.id);
        line.setAttribute('x1', item.point.x.toFixed(2));
        line.setAttribute('y1', item.point.y.toFixed(2));
        line.setAttribute('x2', Math.max(x, Math.min(x + width, item.point.x)).toFixed(2));
        line.setAttribute('y2', Math.max(y, Math.min(y + height, item.point.y)).toFixed(2));
      }
    }
    if (focused?.hidden) this.focus(selectedId, fallback);
  }

  isVisible(id) { return this.buttons.some((button) => button.dataset.gridEntry === id && !button.hidden); }
  focus(id, fallback) {
    (this.buttons.find((button) => button.dataset.gridEntry === id && !button.hidden) ?? fallback)?.focus({ preventScroll: true });
  }
}
