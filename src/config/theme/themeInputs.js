import { DEFAULT_COMPONENT_SLOTS, LEGACY_ALIAS_KEYS, LEGACY_TOKEN_ALIASES, THEME_MODES, THEME_TOKEN_KEYS, THEME_TOKEN_SET } from './themeTokens.js';
import { isPlainObject, warnUnknownThemeKey } from './themeUtils.js';

export function mergeThemeInputs(...inputs) {
  return inputs.reduce((merged, input) => mergeThemeInputInto(merged, input), {});
}

export function mergeThemeInputInto(merged, input) {
  if (!isPlainObject(input)) return merged;
  const next = { ...merged };
  if (THEME_MODES.has(input.mode)) next.mode = input.mode;
  if (typeof input.use === 'string') next.use = input.use;
  if (typeof input.extends === 'string') next.extends = input.extends;

  const tokenInput = extractTokenInput(input);
  if (Object.keys(tokenInput).length > 0) {
    next.tokens = { ...(next.tokens ?? {}), ...tokenInput };
  }

  if (isPlainObject(input.themes)) {
    next.themes = { ...(next.themes ?? {}) };
    Object.entries(input.themes).forEach(([name, themePackage]) => {
      if (!isPlainObject(themePackage)) return;
      next.themes[name] = mergeThemeInputInto(next.themes[name] ?? {}, themePackage);
    });
  }
  if (isPlainObject(input.components)) {
    const legacyComponentThemes = getLegacyComponentThemeMap(input.components);
    if (legacyComponentThemes) next.componentThemes = { ...(next.componentThemes ?? {}), ...legacyComponentThemes };
    const componentSlots = getComponentSlotOverrides(input.components);
    if (Object.keys(componentSlots).length > 0) {
      next.components = mergeComponentSlots(next.components ?? {}, componentSlots);
    }
  }
  if (isPlainObject(input.componentThemes)) {
    next.componentThemes = { ...(next.componentThemes ?? {}), ...input.componentThemes };
  }
  if (isPlainObject(input.teamThemes)) {
    next.teamThemes = { ...(next.teamThemes ?? {}), ...input.teamThemes };
  }

  return next;
}

export function pickTopLevelThemeInput(input) {
  if (!isPlainObject(input)) return {};
  const result = {};
  ['tokens', 'components', 'componentThemes', 'teamThemes', 'light', 'dark'].forEach((key) => {
    if (Object.hasOwn(input, key)) result[key] = input[key];
  });
  [...THEME_TOKEN_KEYS, ...LEGACY_ALIAS_KEYS].forEach((key) => {
    if (Object.hasOwn(input, key)) result[key] = input[key];
  });
  return result;
}

export function extractTokenInput(input) {
  if (!isPlainObject(input)) return {};
  const result = {};
  if (isPlainObject(input.light) || isPlainObject(input.dark)) {
    Object.assign(result, extractModeTokenInput(input.light, input.dark));
  }
  const hasResolvedActiveTokens = isPlainObject(input.activeTokens);
  if (!hasResolvedActiveTokens) {
    THEME_TOKEN_KEYS.forEach((key) => {
      if (Object.hasOwn(input, key)) result[key] = input[key];
    });
    LEGACY_ALIAS_KEYS.forEach((key) => {
      if (Object.hasOwn(input, key)) result[LEGACY_TOKEN_ALIASES[key]] = input[key];
    });
  }
  if (isPlainObject(input.tokens)) {
    const modeTokens = extractModeTokenInput(input.tokens.light, input.tokens.dark);
    Object.assign(result, modeTokens);
    Object.entries(input.tokens).forEach(([key, value]) => {
      if (key === 'light' || key === 'dark') return;
      const tokenKey = LEGACY_TOKEN_ALIASES[key] ?? key;
      if (THEME_TOKEN_SET.has(tokenKey)) result[tokenKey] = value;
      else warnUnknownThemeKey(key);
    });
  }
  return result;
}

function extractModeTokenInput(lightInput, darkInput) {
  const result = {};
  addModeTokens(result, 'light', lightInput);
  addModeTokens(result, 'dark', darkInput);
  return result;
}

function addModeTokens(result, mode, input) {
  if (!isPlainObject(input)) return;
  Object.entries(input).forEach(([key, value]) => {
    const tokenKey = LEGACY_TOKEN_ALIASES[key] ?? key;
    if (!THEME_TOKEN_SET.has(tokenKey)) {
      warnUnknownThemeKey(key);
      return;
    }
    const current = isPlainObject(result[tokenKey]) ? result[tokenKey] : {};
    result[tokenKey] = { ...current, [mode]: value };
  });
}

export function getLegacyComponentThemeMap(components) {
  if (!isPlainObject(components)) return null;
  const entries = Object.entries(components)
    .map(([componentName, value]) => [
      componentName,
      typeof value === 'string' ? value : isPlainObject(value) && typeof value.theme === 'string' ? value.theme : null,
    ])
    .filter(([, selector]) => selector);
  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

export function getComponentSlotOverrides(components) {
  if (!isPlainObject(components)) return {};
  const result = {};
  Object.entries(components).forEach(([componentName, slots]) => {
    const canonicalName = normalizeComponentSlotName(componentName);
    const schema = DEFAULT_COMPONENT_SLOTS[canonicalName];
    if (!schema || !isPlainObject(slots)) return;
    Object.entries(slots).forEach(([slot, tokenName]) => {
      if (slot === 'theme') return;
      if (!Object.hasOwn(schema, slot) || !THEME_TOKEN_SET.has(tokenName)) {
        warnUnknownThemeKey(`${componentName}.${slot}`);
        return;
      }
      result[canonicalName] = {
        ...(result[canonicalName] ?? {}),
        [slot]: tokenName,
      };
    });
  });
  return result;
}

export function mergeComponentSlots(parent = {}, overrides = {}) {
  const result = {};
  Object.entries(parent).forEach(([componentName, slots]) => {
    result[componentName] = { ...slots };
  });
  Object.entries(overrides).forEach(([componentName, slots]) => {
    if (!Object.hasOwn(DEFAULT_COMPONENT_SLOTS, componentName)) return;
    result[componentName] = {
      ...(result[componentName] ?? DEFAULT_COMPONENT_SLOTS[componentName]),
      ...slots,
    };
  });
  return result;
}

function normalizeComponentSlotName(name) {
  return String(name).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}
