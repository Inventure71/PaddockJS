import { normalizeCssColorToken } from './themeOptions.js';

export const DEFAULT_SAFE_DRIVER_COLOR = '#e10600';

export function formatCssColor(value, fallback = DEFAULT_SAFE_DRIVER_COLOR) {
  return normalizeCssColorToken(value, fallback);
}

export function formatCssUrl(value) {
  const raw = String(value ?? '');
  const escaped = raw
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replace(/[\u0000-\u001F\u007F]/g, '');
  return `url("${escaped}")`;
}
