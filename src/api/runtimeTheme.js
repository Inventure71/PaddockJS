import { resolveF1SimulatorOptions } from '../config/defaultOptions.js';
import { mergeThemeInputs } from '../config/themeOptions.js';

export function resolveRuntimeThemeOptions(currentOptions, themeInput = {}) {
  return resolveF1SimulatorOptions({
    ...currentOptions,
    theme: mergeThemeInputs(currentOptions?.theme, themeInput),
  });
}

export function resolveRuntimeThemeModeOptions(currentOptions, mode) {
  return resolveRuntimeThemeOptions(currentOptions, { mode });
}

export function createThemeSync(simulator, source, {
  attribute = 'data-theme',
  map,
} = {}) {
  if (!source || typeof source !== 'object') {
    throw new Error('syncThemeFrom requires a DOM element or attribute source.');
  }

  const readValue = () => {
    const rawValue = typeof source.getAttribute === 'function'
      ? source.getAttribute(attribute)
      : source?.dataset?.[attributeToDatasetKey(attribute)];
    if (map && Object.hasOwn(map, rawValue)) return map[rawValue];
    return rawValue;
  };

  const sync = () => {
    const value = readValue();
    if (value && typeof value === 'object') {
      simulator.setTheme(value);
      return;
    }
    simulator.setThemeMode(typeof value === 'string' && value !== '' ? value : 'dark');
  };

  sync();

  const Observer = globalThis.MutationObserver;
  if (typeof Observer !== 'function' || typeof source.getAttribute !== 'function') {
    return () => {};
  }

  const observer = new Observer(sync);
  observer.observe(source, {
    attributes: true,
    attributeFilter: [attribute],
  });
  return () => observer.disconnect();
}

function attributeToDatasetKey(attribute) {
  return String(attribute)
    .replace(/^data-/, '')
    .replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}
