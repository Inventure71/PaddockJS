const THEME_MODES = new Set(['dark', 'light', 'system']);
const ACTIVE_THEME_MODES = new Set(['dark', 'light']);
const GENERATED_COLOR_CACHE = new Map();
const RESOLVED_THEME_CACHE = new Map();

export const THEME_COLOR_TOKEN_KEYS = [
  'primary',
  'primaryText',
  'secondary',
  'secondaryText',
  'surface',
  'surfaceRaised',
  'surfacePanel',
  'text',
  'mutedText',
  'border',
  'success',
  'warning',
  'danger',
  'info',
  'yellowFlag',
  'greenFlag',
  'redFlag',
  'safetyCar',
  'drsActive',
  'pitLane',
  'track',
  'trackEdge',
];

export const THEME_SIZE_TOKEN_KEYS = [
  'timingTowerMaxWidth',
  'raceViewMinHeight',
];

const THEME_TOKEN_KEYS = [...THEME_COLOR_TOKEN_KEYS, ...THEME_SIZE_TOKEN_KEYS];
export const PADDOCK_THEME_TOKEN_KEYS = THEME_TOKEN_KEYS;
const THEME_TOKEN_SET = new Set(THEME_TOKEN_KEYS);
const COLOR_TOKEN_SET = new Set(THEME_COLOR_TOKEN_KEYS);
const SIZE_TOKEN_SET = new Set(THEME_SIZE_TOKEN_KEYS);

const LEGACY_TOKEN_ALIASES = {
  accentColor: 'primary',
  greenColor: 'greenFlag',
  yellowColor: 'yellowFlag',
  blueColor: 'info',
  raceControlRedColor: 'redFlag',
  surfaceColor: 'surface',
  surfaceRaisedColor: 'surfaceRaised',
  surfacePanelColor: 'surfacePanel',
  lineColor: 'border',
  lineStrongColor: 'border',
  textColor: 'text',
  mutedTextColor: 'mutedText',
  trackColor: 'track',
  trackEdgeColor: 'trackEdge',
};

const LEGACY_ALIAS_KEYS = Object.keys(LEGACY_TOKEN_ALIASES);

export const PADDOCK_THEME_CSS_VARIABLES = {
  primary: '--paddock-color-primary',
  primaryText: '--paddock-color-primary-text',
  secondary: '--paddock-color-secondary',
  secondaryText: '--paddock-color-secondary-text',
  surface: '--paddock-color-surface',
  surfaceRaised: '--paddock-color-surface-raised',
  surfacePanel: '--paddock-color-surface-panel',
  text: '--paddock-color-text',
  mutedText: '--paddock-color-muted-text',
  border: '--paddock-color-border',
  success: '--paddock-color-success',
  warning: '--paddock-color-warning',
  danger: '--paddock-color-danger',
  info: '--paddock-color-info',
  yellowFlag: '--paddock-color-yellow-flag',
  greenFlag: '--paddock-color-green-flag',
  redFlag: '--paddock-color-red-flag',
  safetyCar: '--paddock-color-safety-car',
  drsActive: '--paddock-color-drs-active',
  pitLane: '--paddock-color-pit-lane',
  track: '--paddock-color-track',
  trackEdge: '--paddock-color-track-edge',
  timingTowerMaxWidth: '--paddock-timing-tower-max-width',
  raceViewMinHeight: '--paddock-race-view-min-height',
};

const LEGACY_THEME_CSS_VARIABLES = {
  accentColor: '--paddock-accent-color',
  greenColor: '--paddock-green-color',
  yellowColor: '--paddock-yellow-color',
  blueColor: '--paddock-blue-color',
  raceControlRedColor: '--paddock-race-control-red-color',
  surfaceColor: '--paddock-surface-color',
  surfaceRaisedColor: '--paddock-surface-raised-color',
  surfacePanelColor: '--paddock-surface-panel-color',
  lineColor: '--paddock-line-color',
  lineStrongColor: '--paddock-line-strong-color',
  textColor: '--paddock-text-color',
  mutedTextColor: '--paddock-muted-text-color',
  trackColor: '--paddock-track-color',
  trackEdgeColor: '--paddock-track-edge-color',
};

const DEFAULT_COMPONENT_SLOTS = {
  button: {
    background: 'primary',
    text: 'primaryText',
    border: 'primary',
  },
  raceControls: {
    background: 'surfacePanel',
    text: 'text',
    border: 'border',
    accent: 'primary',
  },
  cameraControls: {
    background: 'surfacePanel',
    text: 'text',
    border: 'border',
    accent: 'primary',
  },
  timingTower: {
    shellBackground: 'surfacePanel',
    rowBackground: 'surfaceRaised',
    driverText: 'text',
    gapText: 'mutedText',
    warningText: 'yellowFlag',
  },
  raceCanvas: {
    track: 'track',
    trackEdge: 'trackEdge',
    pitLane: 'pitLane',
  },
  raceDataPanel: {
    background: 'surfacePanel',
    text: 'text',
    accent: 'primary',
  },
  selectedDriverPanel: {
    background: 'surfacePanel',
    text: 'text',
    accent: 'primary',
  },
  driverRows: {
    background: 'surfaceRaised',
    text: 'text',
    accent: 'primary',
  },
};

const DEFAULT_COMPONENT_THEME_SELECTORS = {
  'car-driver-overview': 'selectedTeam',
  'race-data-panel': 'selectedTeam',
};

const PADDOCK_COMPONENT_SLOT_CSS_VARIABLES = Object.entries(DEFAULT_COMPONENT_SLOTS).flatMap(([componentName, slots]) => (
  Object.keys(slots).map((slot) => `--paddock-${toKebabCase(componentName)}-${toKebabCase(slot)}`)
));

const PADDOCK_THEME_SCOPED_CSS_VARIABLES = [
  ...new Set([
    ...Object.values(PADDOCK_THEME_CSS_VARIABLES),
    ...Object.values(LEGACY_THEME_CSS_VARIABLES),
    ...PADDOCK_COMPONENT_SLOT_CSS_VARIABLES,
  ]),
];

const PACKAGE_COMPONENT_THEME_KEYS = new Set([
  'button',
  'race-controls',
  'camera-controls',
  'safety-car-control',
  'timing-tower',
  'race-canvas',
  'race-data-panel',
  'car-driver-overview',
  'race-telemetry-drawer',
  'telemetry-stack',
  'telemetry-core',
  'telemetry-sectors',
  'telemetry-lap-times',
  'telemetry-sector-times',
  'telemetry-sector-banner',
  'steward-message',
  'driver-rows',
]);

const COMPONENT_THEME_SELECTOR_ALIASES = {
  selectedDriverPanel: ['car-driver-overview', 'race-data-panel'],
  carDriverOverview: ['car-driver-overview'],
};

export const DEFAULT_DARK_THEME_TOKENS = {
  primary: '#e10600',
  primaryText: '#ffffff',
  secondary: '#151923',
  secondaryText: '#f4f7fb',
  surface: '#08090b',
  surfaceRaised: '#111318',
  surfacePanel: '#171a20',
  text: '#f4f7fb',
  mutedText: '#8d97a7',
  border: 'rgba(255, 255, 255, 0.13)',
  success: '#14c784',
  warning: '#ffd166',
  danger: '#e10600',
  info: '#39a7ff',
  yellowFlag: '#ffd166',
  greenFlag: '#14c784',
  redFlag: '#e10600',
  safetyCar: '#f5c542',
  drsActive: '#8b5cf6',
  pitLane: '#2f3540',
  track: '#262a31',
  trackEdge: '#f4f7fb',
  timingTowerMaxWidth: '390px',
  raceViewMinHeight: '620px',
};

export const DEFAULT_LIGHT_THEME_TOKENS = {
  primary: '#c90400',
  primaryText: '#ffffff',
  secondary: '#eef2f7',
  secondaryText: '#111827',
  surface: '#f6f8fb',
  surfaceRaised: '#ffffff',
  surfacePanel: '#eef2f7',
  text: '#111827',
  mutedText: '#5d6675',
  border: 'rgba(17, 24, 39, 0.16)',
  success: '#0f9f6a',
  warning: '#b97800',
  danger: '#c90400',
  info: '#1e74c9',
  yellowFlag: '#b97800',
  greenFlag: '#0f9f6a',
  redFlag: '#c90400',
  safetyCar: '#b97800',
  drsActive: '#6d28d9',
  pitLane: '#d8dee8',
  track: '#d7dde6',
  trackEdge: '#111827',
  timingTowerMaxWidth: '390px',
  raceViewMinHeight: '620px',
};

export const DEFAULT_PADDOCK_THEME_INPUT = {
  mode: 'dark',
  use: 'default',
};
export const DEFAULT_PADDOCK_THEME = DEFAULT_PADDOCK_THEME_INPUT;

const DEFAULT_THEME_PACKAGE = {
  tokens: {
    light: DEFAULT_LIGHT_THEME_TOKENS,
    dark: DEFAULT_DARK_THEME_TOKENS,
  },
  components: DEFAULT_COMPONENT_SLOTS,
};

export function mergeThemeInputs(...inputs) {
  return inputs.reduce((merged, input) => mergeThemeInputInto(merged, input), {});
}

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

export function applyPaddockThemeCssVariables(root, theme = DEFAULT_PADDOCK_THEME_INPUT, context = {}) {
  const resolved = isResolvedTheme(theme) ? theme : normalizePaddockTheme(theme);
  const activeMode = resolveActiveThemeMode(resolved.mode);
  root?.setAttribute?.('data-paddock-theme-mode', activeMode);
  applyResolvedThemeCssVariables(root, resolved.themes?.[resolved.use] ?? resolved, activeMode);

  getComponentElements(root).forEach((element) => {
    const componentName = element.getAttribute?.('data-paddock-component');
    const themeName = resolved.componentThemes?.[componentName];
    const selectedTheme = selectThemePackage(themeName, resolved, context);
    if (!selectedTheme) {
      if (element !== root) clearPaddockThemeCssVariables(element);
      return;
    }
    applyResolvedThemeCssVariables(element, selectedTheme, activeMode);
  });
}

export const resolvePaddockTheme = normalizePaddockTheme;
export const applyPaddockTheme = applyPaddockThemeCssVariables;

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

export function deriveDarkColor(lightColor) {
  return deriveModeColor('dark', 'primary', lightColor);
}

export function deriveLightColor(darkColor) {
  return deriveModeColor('light', 'primary', darkColor);
}

export function resolveModePair(value, fallbackPair = {
  light: DEFAULT_LIGHT_THEME_TOKENS.primary,
  dark: DEFAULT_DARK_THEME_TOKENS.primary,
}) {
  return resolveColorModePair('primary', value, fallbackPair);
}

function mergeThemeInputInto(merged, input) {
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

function pickTopLevelThemeInput(input) {
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

function extractTokenInput(input) {
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

function getLegacyComponentThemeMap(components) {
  if (!isPlainObject(components)) return null;
  const entries = Object.entries(components)
    .map(([componentName, value]) => [
      componentName,
      typeof value === 'string' ? value : isPlainObject(value) && typeof value.theme === 'string' ? value.theme : null,
    ])
    .filter(([, selector]) => selector);
  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

function getComponentSlotOverrides(components) {
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

function mergeComponentSlots(parent = {}, overrides = {}) {
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

function normalizeThemeSelectors(selectors, themes) {
  if (!isPlainObject(selectors)) return {};
  return Object.fromEntries(
    Object.entries(selectors)
      .map(([key, selector]) => [
        key,
        typeof selector === 'string' ? selector : isPlainObject(selector) ? selector.theme : null,
      ])
      .filter(([, selector]) => isValidThemeSelector(selector, themes)),
  );
}

function normalizeComponentThemeSelectors(selectors, themes) {
  if (!isPlainObject(selectors)) return {};
  const result = {};
  Object.entries(selectors).forEach(([key, selectorInput]) => {
    const selector = typeof selectorInput === 'string'
      ? selectorInput
      : isPlainObject(selectorInput)
        ? selectorInput.theme
        : null;
    if (!isValidThemeSelector(selector, themes)) return;
    normalizeComponentThemeSelectorKeys(key).forEach((componentKey) => {
      if (PACKAGE_COMPONENT_THEME_KEYS.has(componentKey)) result[componentKey] = selector;
      else warnUnknownThemeKey(key);
    });
  });
  return result;
}

function normalizeComponentThemeSelectorKeys(key) {
  const raw = String(key);
  if (COMPONENT_THEME_SELECTOR_ALIASES[raw]) return COMPONENT_THEME_SELECTOR_ALIASES[raw];
  return [raw.includes('-') ? raw : toKebabCase(raw)];
}

function isValidThemeSelector(selector, themes) {
  if (typeof selector !== 'string' || selector === '') return false;
  if (selector === 'default' || selector === 'active' || selector === 'selectedTeam' || selector === 'team') return true;
  if (selector.startsWith('team:')) return selector.length > 5;
  return Object.hasOwn(themes, selector);
}

function selectThemePackage(selector, resolved, context = {}, visitedTeamIds = new Set()) {
  if (!selector || selector === 'active') return null;
  if (selector === 'default') return resolved.themes?.default;
  if (selector === 'team' || selector === 'selectedTeam' || selector.startsWith('team:')) {
    const teamId = selector.startsWith('team:')
      ? selector.slice(5)
      : selector === 'selectedTeam'
        ? context.selectedTeamId
        : context.teamId ?? context.selectedTeamId;
    const teamTheme = selectTeamThemePackage(teamId, resolved, context, visitedTeamIds);
    return teamTheme ?? resolved.themes?.[resolved.use] ?? resolved.themes?.default;
  }
  return resolved.themes?.[selector] ?? null;
}

function selectTeamThemePackage(teamId, resolved, context, visitedTeamIds) {
  if (typeof teamId !== 'string' || teamId === '' || visitedTeamIds.has(teamId)) return null;
  const selector = resolved.teamThemes?.[teamId];
  if (!selector) return null;
  visitedTeamIds.add(teamId);
  if (selector === 'team' || selector === 'selectedTeam') return null;
  return selectThemePackage(selector, resolved, context, visitedTeamIds);
}

function applyResolvedThemeCssVariables(target, themePackage, activeMode) {
  clearPaddockThemeCssVariables(target);
  const tokens = themePackage?.tokens?.[activeMode] ?? themePackage?.activeTokens ?? {};
  applyTokenCssVariables(target, tokens);
  applyComponentSlotCssVariables(target, tokens, themePackage?.components);
}

function clearPaddockThemeCssVariables(target) {
  const removeProperty = target?.style?.removeProperty;
  if (typeof removeProperty !== 'function') return;
  PADDOCK_THEME_SCOPED_CSS_VARIABLES.forEach((variable) => {
    removeProperty.call(target.style, variable);
  });
}

function applyTokenCssVariables(target, tokens = {}) {
  Object.entries(PADDOCK_THEME_CSS_VARIABLES).forEach(([key, variable]) => {
    const value = tokens[key];
    if (value == null || value === '') return;
    target?.style?.setProperty?.(variable, String(value));
  });
  Object.entries(LEGACY_THEME_CSS_VARIABLES).forEach(([legacyKey, variable]) => {
    const tokenKey = LEGACY_TOKEN_ALIASES[legacyKey];
    const value = tokens[tokenKey];
    if (value == null || value === '') return;
    target?.style?.setProperty?.(variable, String(value));
  });
}

function applyComponentSlotCssVariables(target, tokens = {}, components = {}) {
  Object.entries(components).forEach(([componentName, slots]) => {
    Object.entries(slots).forEach(([slot, tokenName]) => {
      const value = tokens[tokenName];
      if (value == null || value === '') return;
      target?.style?.setProperty?.(`--paddock-${toKebabCase(componentName)}-${toKebabCase(slot)}`, String(value));
    });
  });
}

function toLegacyThemeTokens(tokens = {}) {
  const aliases = {};
  Object.entries(LEGACY_TOKEN_ALIASES).forEach(([legacyKey, tokenKey]) => {
    aliases[legacyKey] = tokens[tokenKey];
  });
  return { ...tokens, ...aliases };
}

function getComponentElements(root) {
  const elements = [];
  if (root?.matches?.('[data-paddock-component]')) elements.push(root);
  root?.querySelectorAll?.('[data-paddock-component]')?.forEach?.((element) => elements.push(element));
  return elements;
}

function normalizeComponentSlotName(name) {
  return String(name).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}

function normalizeCssSizeToken(value, fallback = null) {
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

function deriveModeColor(mode, key, value) {
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

function resolveActiveThemeMode(mode) {
  if (ACTIVE_THEME_MODES.has(mode)) return mode;
  if (globalThis.matchMedia?.('(prefers-color-scheme: light)')?.matches) return 'light';
  return 'dark';
}

function isResolvedTheme(theme) {
  return isPlainObject(theme) && isPlainObject(theme.tokens) && isPlainObject(theme.themes) && isPlainObject(theme.componentThemes);
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

function toKebabCase(value) {
  return String(value)
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/_/g, '-')
    .toLowerCase();
}

function warnUnknownThemeKey(key) {
  if (globalThis.process?.env?.NODE_ENV === 'production') return;
  globalThis.console?.warn?.(`[PaddockJS] Ignoring unknown theme token or slot "${key}".`);
}

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}
