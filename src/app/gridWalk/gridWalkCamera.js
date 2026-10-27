export function gridWalkOrientation(width, height, previous = null) {
  const ratio = width / Math.max(1, height);
  if (previous === 'horizontal' && ratio >= 0.92) return previous;
  if (previous === 'vertical' && ratio <= 1.08) return previous;
  return ratio >= 1 ? 'horizontal' : 'vertical';
}

function gridAxes(cars) {
  const heading = cars[0].heading;
  const cos = Math.cos(heading);
  const sin = Math.sin(heading);
  const along = cars.map((car) => car.x * cos + car.y * sin);
  const across = cars.map((car) => -car.x * sin + car.y * cos);
  return { heading, cos, sin, along, across };
}

// A camera has one position along the original grid. Selection, orientation and
// container sizing never introduce a second axis or a different framing mode.
export function gridWalkCameraFrame({ cars, selectedId, width, height, orientation, bannerSize = 0, area,
  position = null }) {
  const { heading, cos, sin, along, across } = gridAxes(cars);
  const horizontal = orientation === 'horizontal';
  area ??= { left: 16, top: width < 600 ? 144 : 82, right: width - 16, bottom: height - 16 - bannerSize };
  const availableWidth = Math.max(1, area.right - area.left);
  const availableHeight = Math.max(1, area.bottom - area.top);
  const crossSpan = Math.max(...across) - Math.min(...across);
  const spacing = cars.length > 1 ? (Math.max(...along) - Math.min(...along)) / (cars.length - 1) : 96;
  const scale = Math.max(0.05, Math.min(
    (horizontal ? availableWidth : availableHeight) / (spacing * 2 + 180),
    (horizontal ? availableHeight : availableWidth) / (crossSpan + (horizontal ? 180 : 210)), 2.4,
  ));
  const selected = Math.max(0, cars.findIndex((car) => car.id === selectedId));
  const minPosition = Math.min(...along) - spacing;
  const maxPosition = Math.max(...along) + spacing;
  const activePosition = Math.max(minPosition, Math.min(maxPosition, position ?? along[selected]));
  const cross = (Math.min(...across) + Math.max(...across)) / 2;
  const center = { x: activePosition * cos - cross * sin, y: activePosition * sin + cross * cos };
  const rotation = (horizontal ? 0 : -Math.PI / 2) - heading;
  const rcos = Math.cos(rotation);
  const rsin = Math.sin(rotation);
  const frame = {
    rotation, scale, center, position: activePosition, minPosition, maxPosition, orientation, area,
    x: area.left + availableWidth / 2 - (center.x * rcos - center.y * rsin) * scale,
    y: area.top + availableHeight / 2 - (center.x * rsin + center.y * rcos) * scale,
  };
  frame.visibleIds = cars.filter((car) => isGridPointVisible(frame, car)).map((car) => car.id);
  return frame;
}

export function isGridPointVisible(frame, car, margin = 24) {
  const point = projectGridPoint(frame, car);
  const { area } = frame;
  return point.x >= area.left + margin && point.x <= area.right - margin &&
    point.y >= area.top + margin && point.y <= area.bottom - margin;
}

export function projectGridPoint(frame, point) {
  const cos = Math.cos(frame.rotation);
  const sin = Math.sin(frame.rotation);
  return { x: frame.x + (point.x * cos - point.y * sin) * frame.scale,
    y: frame.y + (point.x * sin + point.y * cos) * frame.scale };
}

export class GridWalkCamera {
  constructor(cars) { this.cars = cars; this.position = null; }

  update(input) {
    this.frame = gridWalkCameraFrame({ ...input, cars: this.cars, position: this.position });
    this.position = this.frame.position;
    return this.frame;
  }

  pan(delta) {
    if (!this.frame || !delta) return false;
    const sign = this.frame.orientation === 'horizontal' ? -1 : 1;
    this.position = Math.max(this.frame.minPosition, Math.min(this.frame.maxPosition,
      this.position + sign * delta / this.frame.scale));
    return true;
  }

  focus(id) {
    const index = this.cars.findIndex((car) => car.id === id);
    if (index < 0) return;
    this.position = gridAxes(this.cars).along[index];
  }
}
