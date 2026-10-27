import { DEFAULT_COMPONENT_THEME_SELECTORS, DEFAULT_THEME_PACKAGE, LEGACY_TOKEN_ALIASES, THEME_COLOR_TOKEN_KEYS, THEME_MODES, THEME_SIZE_TOKEN_KEYS } from './themeTokens.js';
import { extractTokenInput, getComponentSlotOverrides, getLegacyComponentThemeMap, mergeComponentSlots, mergeThemeInputInto, pickTopLevelThemeInput } from './themeInputs.js';
import { deriveModeColor, normalizeCssColorToken, normalizeCssSizeToken } from './cssTokens.js';
import { normalizeComponentThemeSelectors, normalizeThemeSelectors } from './themeSelectors.js';
import { isPlainObject } from './themeUtils.js';

const ACTIVE_THEME_MODES = new Set(['dark', 'light']);
const RESOLVED_THEME_CACHE = new Map();

export function normalizePaddockTheme(input = {}) {
  const mode = THEME_MODES.has(input?.mode) ? input.mode : 'dark';
  const activeMode = resolveActiveThemeMode(mode);
  const cacheKey = stableStringify({ input, activeMode });
  if (RESOLVED_THEME_CACHE.has(cacheKey)) return RESOLVED_THEME_CACHE.get(cacheKey);

  const themeInputs = isPlainObject(input?.themes) ? input.themes : {};
  const resolving = new Set();
  const resolvedThemes = {};

  const resolveNamedTheme = (name) => {
    const themeName = typeof name === 'string' && name !== '' ? name : 'default';
    if (resolvedThemes[themeName]) return resolvedThemes[themeName];
    if (resolving.has(themeName)) return resolvedThemes.default ?? DEFAULT_THEME_PACKAGE;
    resolving.add(themeName);

    const rawPackage = themeName === 'default'
      ? mergeThemeInputInto(themeInputs.default ?? {}, pickTopLevelThemeInput(input))
      : themeInputs[themeName];
    const parentName = themeName === 'default'
      ? null
      : typeof rawPackage?.extends === 'string' && rawPackage.extends !== themeName
        ? rawPackage.extends
        : 'default';
    const parent = parentName ? resolveNamedTheme(parentName) : DEFAULT_THEME_PACKAGE;
    const resolved = resolveThemePackage(rawPackage, parent);
    resolvedThemes[themeName] = resolved;
    resolving.delete(themeName);
    return resolved;
  };

  resolveNamedTheme('default');
  Object.keys(themeInputs).forEach((name) => {
    if (isPlainObject(themeInputs[name])) resolveNamedTheme(name);
  });

  const requestedUse = typeof input?.use === 'string' ? input.use : 'default';
  const use = Object.hasOwn(resolvedThemes, requestedUse) ? requestedUse : 'default';
  const activeTheme = resolvedThemes[use] ?? resolvedThemes.default;
  const activeTokens = activeTheme.tokens[activeMode];
  const componentThemes = {
    ...DEFAULT_COMPONENT_THEME_SELECTORS,
    ...normalizeComponentThemeSelectors(
      input?.componentThemes ?? getLegacyComponentThemeMap(input?.components),
      resolvedThemes,
    ),
  };
  const teamThemes = normalizeThemeSelectors(input?.teamThemes, resolvedThemes);
  const result = {
    mode,
    activeMode,
    use,
    tokens: activeTheme.tokens,
    activeTokens,
    components: activeTheme.components,
    themes: resolvedThemes,
    componentThemes,
    teamThemes,
    light: toLegacyThemeTokens(activeTheme.tokens.light),
    dark: toLegacyThemeTokens(activeTheme.tokens.dark),
    ...toLegacyThemeTokens(activeTokens),
  };

  RESOLVED_THEME_CACHE.set(cacheKey, result);
  return result;
}

function resolveThemePackage(input, parent = DEFAULT_THEME_PACKAGE) {
  const tokenInput = extractTokenInput(input);
  const tokens = {
    light: {},
    dark: {},
  };

  THEME_COLOR_TOKEN_KEYS.forEach((key) => {
    const fallbackPair = {
      light: parent.tokens.light[key],
      dark: parent.tokens.dark[key],
    };
    const pair = Object.hasOwn(tokenInput, key)
      ? resolveColorModePair(key, tokenInput[key], fallbackPair)
      : fallbackPair;
    tokens.light[key] = pair.light;
    tokens.dark[key] = pair.dark;
  });

  THEME_SIZE_TOKEN_KEYS.forEach((key) => {
    const fallbackPair = {
      light: parent.tokens.light[key],
      dark: parent.tokens.dark[key],
    };
    const pair = Object.hasOwn(tokenInput, key)
      ? resolveSizeModePair(tokenInput[key], fallbackPair)
      : fallbackPair;
    tokens.light[key] = pair.light;
    tokens.dark[key] = pair.dark;
  });

  return {
    tokens,
    components: mergeComponentSlots(parent.components, getComponentSlotOverrides(input?.components)),
  };
}

function resolveColorModePair(key, value, fallbackPair) {
  const pair = isPlainObject(value) ? value : { light: value, dark: value };
  const light = normalizeCssColorToken(pair.light, null);
  const dark = normalizeCssColorToken(pair.dark, null);
  if (light && dark) return { light, dark };
  if (light) return {
    light,
    dark: deriveModeColor('dark', key, light) ?? fallbackPair.dark,
  };
  if (dark) return {
    light: deriveModeColor('light', key, dark) ?? fallbackPair.light,
    dark,
  };
  return fallbackPair;
}

function resolveSizeModePair(value, fallbackPair) {
  const pair = isPlainObject(value) ? value : { light: value, dark: value };
  const light = normalizeCssSizeToken(pair.light, null);
  const dark = normalizeCssSizeToken(pair.dark, null);
  if (light && dark) return { light, dark };
  if (light) return { light, dark: light };
  if (dark) return { light: dark, dark };
  return fallbackPair;
}

function toLegacyThemeTokens(tokens = {}) {
  const aliases = {};
  Object.entries(LEGACY_TOKEN_ALIASES).forEach(([legacyKey, tokenKey]) => {
    aliases[legacyKey] = tokens[tokenKey];
  });
  return { ...tokens, ...aliases };
}

export function resolveActiveThemeMode(mode) {
  if (ACTIVE_THEME_MODES.has(mode)) return mode;
  if (globalThis.matchMedia?.('(prefers-color-scheme: light)')?.matches) return 'light';
  return 'dark';
}

function stableStringify(value) {
  return JSON.stringify(sortForStableStringify(value, new WeakSet()));
}

function sortForStableStringify(value, seen) {
  if (typeof value === 'bigint') return `bigint:${value.toString()}`;
  if (typeof value === 'function') return `function:${value.name ?? ''}`;
  if (typeof value === 'symbol') return value.toString();
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return value.map((item) => sortForStableStringify(item, seen));
  if (!isPlainObject(value)) return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortForStableStringify(value[key], seen)]),
  );
}
