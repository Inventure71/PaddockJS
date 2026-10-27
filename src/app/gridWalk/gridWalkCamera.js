export function gridWalkOrientation(width, height, previous = null) {
  const ratio = width / Math.max(1, height);
  if (previous === 'horizontal' && ratio >= 0.92) return previous;
  if (previous === 'vertical' && ratio <= 1.08) return previous;
  return ratio >= 1 ? 'horizontal' : 'vertical';
}

export function gridWalkCameraFrame({ cars, selectedId, width, height, orientation, inspectorSize = 0 }) {
  const selected = Math.max(0, cars.findIndex((car) => car.id === selectedId));
  const horizontal = orientation === 'horizontal';
  const count = Math.min(3, Math.max(1, Math.floor(horizontal
    ? (width - inspectorSize - 32) / 190
    : (height - inspectorSize - 142) / 140)));
  const start = Math.max(0, Math.min(selected - Math.floor(count / 2), cars.length - count));
  const visible = cars.slice(start, start + count);
  const target = cars[selected];
  const rotation = (horizontal ? 0 : -Math.PI / 2) - target.heading;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const points = visible.map((car) => ({ x: car.x * cos - car.y * sin, y: car.x * sin + car.y * cos }));
  const left = 16;
  const top = 74;
  const right = width - 16 - (horizontal ? inspectorSize : 0);
  const bottom = height - 68 - (horizontal ? 0 : inspectorSize);
  const availableWidth = Math.max(1, right - left);
  const availableHeight = Math.max(1, bottom - top);
  const minX = Math.min(...points.map((p) => p.x));
  const maxX = Math.max(...points.map((p) => p.x));
  const minY = Math.min(...points.map((p) => p.y));
  const maxY = Math.max(...points.map((p) => p.y));
  const scale = Math.max(0.05, Math.min(
    availableWidth / (maxX - minX + (horizontal ? 200 : 290)),
    availableHeight / (maxY - minY + (horizontal ? 230 : 110)),
    2.4,
  ));
  return {
    rotation, scale, visibleIds: visible.map((car) => car.id),
    area: { left, top, right, bottom },
    x: left + availableWidth / 2 - (minX + maxX) / 2 * scale,
    y: top + availableHeight / 2 - (minY + maxY) / 2 * scale,
  };
}

export function projectGridPoint(frame, point) {
  const cos = Math.cos(frame.rotation);
  const sin = Math.sin(frame.rotation);
  return {
    x: frame.x + (point.x * cos - point.y * sin) * frame.scale,
    y: frame.y + (point.x * sin + point.y * cos) * frame.scale,
  };
}
