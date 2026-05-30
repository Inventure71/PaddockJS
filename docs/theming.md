# Theming

PaddockJS exposes a public theme API so host websites can sync simulator colors with site-level light/dark modes without copying private CSS variable names.

## Mount-Time Theme

```js
await mountF1Simulator(root, {
  drivers,
  entries,
  theme: {
    mode: 'system',
    tokens: {
      primary: { light: '#008c55', dark: '#00ff84' },
      pitLane: '#7c3aed',
    },
  },
});
```

Mount-time `theme` sets defaults for a new simulator.

## Runtime Theme Changes

Use controller methods for site toggles:

```js
simulator.setThemeMode('dark');

simulator.setTheme({
  mode: 'light',
  tokens: { primary: '#008c55' },
});

const stopThemeSync = simulator.syncThemeFrom(document.documentElement, {
  attribute: 'data-theme',
  map: { light: 'light', dark: 'dark' },
});
```

Do not call `restart({ theme })` only to change presentation. Runtime theme APIs update package CSS variables while preserving race state, selected driver, active penalties, speed, camera state, and pit intent state.

## Public Helpers

```js
import {
  DEFAULT_PADDOCK_THEME,
  PADDOCK_THEME_CSS_VARIABLES,
  PADDOCK_THEME_TOKEN_KEYS,
  applyPaddockTheme,
  resolvePaddockTheme,
} from '@inventure71/paddockjs';

applyPaddockTheme(previewRoot, resolvePaddockTheme({
  ...DEFAULT_PADDOCK_THEME,
  mode: 'light',
}));
```

Use these helpers when a host needs a preview, custom theme editor, or site-level sync. Do not mirror `--paddock-color-*` names manually in host code.

## Fonts

The package stylesheet uses system font stacks and does not load remote fonts. Hosts that want branded typography should load fonts in the host app and then theme the simulator through public tokens/CSS variables.
