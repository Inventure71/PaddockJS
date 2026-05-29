# Next Release Host Ergonomics Scope

This document captures the package improvements prompted by the 3.0.0 host-site integration feedback. The release should focus on making PaddockJS easier to embed in real host websites without forcing hosts to duplicate internal package theme details or use race-resetting APIs for presentation changes.

## Release Goal

Make PaddockJS 3.x easier and safer for browser host websites to integrate after the 3.0.0 release, especially for light/dark theme syncing, public theme reuse, and upgrade clarity.

Because this scope adds public API surface, the likely package version is a minor 3.x release rather than a patch-only release.

## Priority 1: Runtime Theme API

Hosts need to change package theme mode and theme selection without restarting the simulator or resetting race state.

Add public controller methods to both `mountF1Simulator()` and `createPaddockSimulator()`:

```js
simulator.setThemeMode('dark');
simulator.setTheme({ mode: 'light', use: 'portfolio' });
simulator.getTheme();
```

Expected behavior:

- Changing theme mode or theme tokens must not call `restart()`.
- Race simulation state, timing order, selected driver, active penalties, camera state, speed setting, and pit intent state must be preserved.
- The API should re-normalize theme input through the same package theme resolver used at mount time.
- The API should reapply package CSS variables to all package-owned mounted roots.
- Component theme selectors and selected-team component styling must remain aligned with the same theme contract used at mount time.
- Invalid theme input should be handled the same way mount-time theme input is handled.

Potential convenience API:

```js
const stopSync = simulator.syncThemeFrom(document.documentElement, {
  attribute: 'data-theme',
  map: { light: 'light', dark: 'dark' },
});
```

This should be built on top of the explicit runtime API. The explicit API is the release-critical part.

## Priority 2: Public Theme Helpers And Constants

Hosts should not mirror private CSS variable names or default token shapes.

Export stable public theme helpers from the root browser package:

```js
import {
  DEFAULT_PADDOCK_THEME,
  PADDOCK_THEME_CSS_VARIABLES,
  PADDOCK_THEME_TOKEN_KEYS,
  applyPaddockTheme,
  resolvePaddockTheme,
} from '@inventure71/paddockjs';
```

Expected behavior:

- `DEFAULT_PADDOCK_THEME` exposes the package default semantic theme input or resolved default theme in a documented shape.
- `PADDOCK_THEME_CSS_VARIABLES` exposes the supported package-owned CSS custom property map.
- `PADDOCK_THEME_TOKEN_KEYS` exposes the supported semantic token names.
- `resolvePaddockTheme(themeInput)` returns the same normalized/resolved shape used by mounts.
- `applyPaddockTheme(root, themeInput, context?)` applies the package CSS variables to a DOM root without requiring a mounted simulator.

Naming should be public and stable. Avoid exposing internal helper names if their current names describe implementation rather than API intent.

## Priority 3: CSS-Free Data Subpath

The package root is intentionally browser-oriented and imports package CSS. That is acceptable for browser mounts, but hosts and tools that only need data helpers should have a Node-safe import path.

Add a public CSS-free subpath:

```js
import {
  DriverData,
  VehicleData,
  buildChampionshipDriverGrid,
  formatDriverNumber,
  normalizeSimulatorDrivers,
  createProceduralTrack,
  kphToSimSpeed,
  simSpeedToKph,
} from '@inventure71/paddockjs/data';
```

Expected behavior:

- `@inventure71/paddockjs/data` must not import package CSS, DOM code, PixiJS, or `F1SimulatorApp`.
- The existing `@inventure71/paddockjs/environment` subpath remains the headless simulation/training runtime.
- The root package remains the browser component API.
- Do not use a vague `core` subpath unless the release intentionally includes non-data runtime helpers there.

## Priority 4: Host Upgrade Guide

The 3.0.0 docs contain the necessary details, but they are spread across several files. Add a short host-focused upgrade checklist.

Create a guide such as:

```text
docs/upgrading-hosts-to-3.md
```

The checklist should cover:

- Install `@inventure71/paddockjs@3`.
- Remove host usage of `trackQueryIndex`.
- Replace `physicsMode: 'simulator'` with `physicsMode: 'advanced'`, or stay on the default `physicsMode: 'arcade'`.
- Decide whether the host should use package theme options and the new runtime theme API.
- Decide whether to enable `ui.driverCamera`.
- Import package CSS intentionally when using browser mounts.
- Use `@inventure71/paddockjs/environment` for headless simulation/training imports.
- Use `@inventure71/paddockjs/data` for CSS-free data/helper imports once the subpath exists.
- Rebuild the host bundle and browser-smoke the host page.

Keep this guide short and practical. It should not duplicate the full data contract.

## Priority 5: Portfolio-Style Theme Sync Example

Add a small example showing the intended host pattern for site-level light/dark toggles.

Example shape:

```js
const simulator = await mountF1Simulator(root, options);

function syncPaddockTheme() {
  simulator.setThemeMode(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
}

syncPaddockTheme();
themeToggle.addEventListener('change', syncPaddockTheme);
```

The example should demonstrate runtime theme updates without calling `restart()`.

## Out Of Scope

- Do not restore `physicsMode: 'simulator'` as a compatibility alias.
- Do not make `restart({ theme })` the recommended way to change host theme.
- Do not require hosts to manually copy package CSS variable names.
- Do not redesign timing tower sizing or broadcast proportions as part of this scope.
- Do not move browser mounts out of the root package.

## Verification Expectations

Minimum verification for this release:

- Unit tests proving `setThemeMode()` and `setTheme()` update theme variables without replacing race state.
- Component-controller tests proving composable mounted roots all receive the updated theme.
- Public type tests for new controller methods, theme exports, and the `./data` subpath.
- A browser smoke path that toggles theme mode at runtime and confirms the canvas/race UI remains mounted.
- `npm run check`.
- `npm run check:release` before release handoff.

