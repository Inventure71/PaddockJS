const TINT_BY_COLOR = new Map();

export function colorToTint(color) {
  if (TINT_BY_COLOR.has(color)) return TINT_BY_COLOR.get(color);
  const tint = Number.parseInt(String(color ?? '').replace('#', ''), 16);
  const normalizedTint = Number.isFinite(tint) ? tint : 0xffffff;
  TINT_BY_COLOR.set(color, normalizedTint);
  return normalizedTint;
}

export function smoothAngle(current, target, amount) {
  if (!Number.isFinite(current)) return target;
  let diff = ((target - current + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return current + diff * amount;
}

export function destroyDisplayChildren(container) {
  container?.removeChildren?.().forEach((child) => {
    child.destroy?.({ children: true, texture: false, textureSource: false });
  });
}
