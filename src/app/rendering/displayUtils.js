import { Color } from 'pixi.js';

const TINT_BY_COLOR = new Map();

export function colorToTint(color) {
  if (TINT_BY_COLOR.has(color)) return TINT_BY_COLOR.get(color);
  let normalizedTint = 0xffffff;
  try {
    normalizedTint = new Color(color ?? 0xffffff).toNumber();
  } catch {
    // Keep unavailable or context-dependent CSS colors on the visible fallback.
  }
  TINT_BY_COLOR.set(color, normalizedTint);
  return normalizedTint;
}

export function smoothAngle(current, target, amount) {
  if (!Number.isFinite(current)) return target;
  let diff = ((target - current + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return current + diff * amount;
}
