export function toKebabCase(value) {
  return String(value)
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/_/g, '-')
    .toLowerCase();
}

export function warnUnknownThemeKey(key) {
  if (globalThis.process?.env?.NODE_ENV === 'production') return;
  globalThis.console?.warn?.(`[PaddockJS] Ignoring unknown theme token or slot "${key}".`);
}

export function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}
