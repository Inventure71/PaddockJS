import { COMPONENT_THEME_SELECTOR_ALIASES, PACKAGE_COMPONENT_THEME_KEYS } from './themeTokens.js';
import { isPlainObject, toKebabCase, warnUnknownThemeKey } from './themeUtils.js';

export function normalizeThemeSelectors(selectors, themes) {
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

export function normalizeComponentThemeSelectors(selectors, themes) {
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

export function selectThemePackage(selector, resolved, context = {}, visitedTeamIds = new Set()) {
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
