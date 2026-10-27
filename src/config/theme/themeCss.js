import { DEFAULT_PADDOCK_THEME_INPUT, LEGACY_THEME_CSS_VARIABLES, LEGACY_TOKEN_ALIASES, PADDOCK_THEME_CSS_VARIABLES, PADDOCK_THEME_SCOPED_CSS_VARIABLES } from './themeTokens.js';
import { normalizePaddockTheme, resolveActiveThemeMode } from './themeResolver.js';
import { selectThemePackage } from './themeSelectors.js';
import { isPlainObject, toKebabCase } from './themeUtils.js';

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

function getComponentElements(root) {
  const elements = [];
  if (root?.matches?.('[data-paddock-component]')) elements.push(root);
  root?.querySelectorAll?.('[data-paddock-component]')?.forEach?.((element) => elements.push(element));
  return elements;
}

function isResolvedTheme(theme) {
  return isPlainObject(theme) && isPlainObject(theme.tokens) && isPlainObject(theme.themes) && isPlainObject(theme.componentThemes);
}
