export function gridWalkOrientation(width, height, previous = null) {
  const ratio = width / Math.max(1, height);
  if (previous === 'horizontal' && ratio >= 0.92) return previous;
  if (previous === 'vertical' && ratio <= 1.08) return previous;
  return ratio >= 1 ? 'horizontal' : 'vertical';
}

export function gridWalkCameraFrame({ cars, selectedId, width, height, orientation, bannerSize = 0, center = null }) {
  const selected = Math.max(0, cars.findIndex((car) => car.id === selectedId));
  const horizontal = orientation === 'horizontal';
  const top = width < 600 ? 144 : 82;
  const count = Math.min(3, Math.max(1, Math.floor(horizontal
    ? (width - 32) / 190
    : (height - bannerSize - top - 32) / 140)));
  const start = Math.max(0, Math.min(selected - Math.floor(count / 2), cars.length - count));
  const visible = cars.slice(start, start + count);
  const target = cars[selected];
  const rotation = (horizontal ? 0 : -Math.PI / 2) - target.heading;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const points = visible.map((car) => ({ x: car.x * cos - car.y * sin, y: car.x * sin + car.y * cos }));
  const left = 16;
  const right = width - 16;
  const bottom = height - 16 - bannerSize;
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
  const automaticCenter = {
    x: ((minX + maxX) / 2 * cos + (minY + maxY) / 2 * sin),
    y: (-(minX + maxX) / 2 * sin + (minY + maxY) / 2 * cos),
  };
  const activeCenter = center ? clampGridWalkCenter(cars, center) : automaticCenter;
  const frame = {
    rotation, scale, center: activeCenter, visibleIds: visible.map((car) => car.id),
    area: { left, top, right, bottom },
    x: left + availableWidth / 2 - (activeCenter.x * cos - activeCenter.y * sin) * scale,
    y: top + availableHeight / 2 - (activeCenter.x * sin + activeCenter.y * cos) * scale,
  };
  if (center) frame.visibleIds = cars.filter((car) => {
    const point = projectGridPoint(frame, car);
    return point.x >= left + 24 && point.x <= right - 24 && point.y >= top + 30 && point.y <= bottom - 30;
  }).map((car) => car.id);
  return frame;
}

// Keep free browsing close to the grid, in world coordinates so resizing and
// rotating the camera retain the same place rather than a stale pixel offset.
export function clampGridWalkCenter(cars, center) {
  const heading = cars[0].heading;
  const cos = Math.cos(heading);
  const sin = Math.sin(heading);
  const along = cars.map((car) => car.x * cos + car.y * sin);
  const across = cars.map((car) => -car.x * sin + car.y * cos);
  const x = Math.max(Math.min(...along) - 80, Math.min(Math.max(...along) + 80, center.x * cos + center.y * sin));
  const y = Math.max(Math.min(...across) - 70, Math.min(Math.max(...across) + 70, -center.x * sin + center.y * cos));
  return { x: x * cos - y * sin, y: x * sin + y * cos };
}

export function panGridWalkCenter(frame, deltaX, deltaY) {
  const cos = Math.cos(frame.rotation);
  const sin = Math.sin(frame.rotation);
  return {
    x: frame.center.x - (deltaX * cos + deltaY * sin) / frame.scale,
    y: frame.center.y - (-deltaX * sin + deltaY * cos) / frame.scale,
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
