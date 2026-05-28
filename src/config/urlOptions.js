const SAFE_ABSOLUTE_URL_PROTOCOLS = new Set(['http:', 'https:']);

export function normalizePublicUrlOption(value, fallback) {
  const fallbackValue = typeof fallback === 'string' && fallback.trim() !== ''
    ? fallback.trim()
    : '';
  if (typeof value !== 'string') return fallbackValue;

  const candidate = value.trim();
  if (candidate === '') return fallbackValue;
  if (/[\u0000-\u001F\u007F]/.test(candidate)) return fallbackValue;
  if (candidate.includes('\\')) return fallbackValue;
  if (candidate.startsWith('#')) return candidate;
  if (candidate.startsWith('//')) return fallbackValue;

  const schemeMatch = /^[A-Za-z][A-Za-z0-9+.-]*:/.exec(candidate);
  if (!schemeMatch) return candidate;

  try {
    const url = new URL(candidate);
    return SAFE_ABSOLUTE_URL_PROTOCOLS.has(url.protocol) ? candidate : fallbackValue;
  } catch {
    return fallbackValue;
  }
}
