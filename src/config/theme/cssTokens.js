const GENERATED_COLOR_CACHE = new Map();

export function normalizeCssColorToken(value, fallback = null) {
  if (typeof value !== 'string') return fallback;
  const candidate = value.trim();
  if (
    candidate === '' ||
    /[\u0000-\u001F\u007F;]/.test(candidate) ||
    /[{};]/.test(candidate) ||
    /\b(?:url|expression)\s*\(/i.test(candidate)
  ) return fallback;

  if (/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(candidate)) return normalizeHexColor(candidate);
  if (/^(?:rgb|rgba|hsl|hsla)\([0-9\s.,%/+*-]+\)$/i.test(candidate)) return candidate;
  if (/^(?:transparent|currentcolor|black|white|red|green|blue|yellow|orange|purple|pink|gray|grey)$/i.test(candidate)) {
    return candidate.toLowerCase();
  }
  return fallback;
}

export function normalizeCssSizeToken(value, fallback = null) {
  if (typeof value !== 'string' && typeof value !== 'number') return fallback;
  const candidate = String(value).trim();
  if (
    candidate === '' ||
    /[\u0000-\u001F\u007F;]/.test(candidate) ||
    /[{};]/.test(candidate) ||
    /\b(?:url|expression)\s*\(/i.test(candidate)
  ) return fallback;
  return candidate;
}

export function deriveModeColor(mode, key, value) {
  const cacheKey = `${mode}:${key}:${value}`;
  if (GENERATED_COLOR_CACHE.has(cacheKey)) return GENERATED_COLOR_CACHE.get(cacheKey);

  const rgb = parseHexColor(value);
  const generated = rgb ? rgbToHex(adjustRgbForMode(rgb, mode)) : value;
  GENERATED_COLOR_CACHE.set(cacheKey, generated);
  return generated;
}

function parseHexColor(value) {
  const normalized = normalizeCssColorToken(value, null);
  if (!normalized?.startsWith?.('#')) return null;
  const hex = normalized.slice(1);
  const expanded = hex.length === 3
    ? hex.split('').map((char) => `${char}${char}`).join('')
    : hex;
  return {
    r: Number.parseInt(expanded.slice(0, 2), 16),
    g: Number.parseInt(expanded.slice(2, 4), 16),
    b: Number.parseInt(expanded.slice(4, 6), 16),
  };
}

function normalizeHexColor(value) {
  const hex = value.slice(1);
  if (hex.length === 3) {
    return `#${hex.split('').map((char) => `${char}${char}`).join('')}`.toLowerCase();
  }
  return value.toLowerCase();
}

function adjustRgbForMode(rgb, mode) {
  const amount = mode === 'light' ? 0.18 : -0.18;
  return {
    r: adjustChannel(rgb.r, amount),
    g: adjustChannel(rgb.g, amount),
    b: adjustChannel(rgb.b, amount),
  };
}

function adjustChannel(channel, amount) {
  const target = amount > 0 ? 255 : 0;
  return Math.round(channel + (target - channel) * Math.abs(amount));
}

function rgbToHex({ r, g, b }) {
  return `#${[r, g, b].map((channel) => clampColorChannel(channel).toString(16).padStart(2, '0')).join('')}`;
}

function clampColorChannel(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}
