# Upgrading Hosts To PaddockJS 4.x

Use this checklist when moving a browser host website from 2.x-era PaddockJS usage to the 4.x package API.

1. Install the 4.x package:

   ```bash
   npm install @inventure71/paddockjs@4
   ```

2. Import package CSS intentionally anywhere browser mounts are used:

   ```js
   import '@inventure71/paddockjs/styles.css';
   ```

   The stylesheet is scoped to PaddockJS roots and uses system fonts by default. Load any branded web fonts from the host app instead of relying on package-side remote font imports.

3. Remove host usage of `trackQueryIndex`. Track query indexing is package-owned and internal in 4.x.

4. Replace `physicsMode: 'simulator'` with `physicsMode: 'advanced'`, or omit `physicsMode` to keep the default `arcade` mode.

5. Decide how the host should theme the simulator. Use mount-time `theme` for defaults, then use `simulator.setThemeMode(mode)` or `simulator.setTheme(theme)` for site light/dark toggles. Do not call `restart({ theme })` only to change presentation.

6. Reuse public theme helpers instead of copying CSS variable names:

   ```js
   import {
     PADDOCK_THEME_CSS_VARIABLES,
     PADDOCK_THEME_TOKEN_KEYS,
     applyPaddockTheme,
     resolvePaddockTheme,
   } from '@inventure71/paddockjs';
   ```

7. Decide whether the host should enable the driver camera with `ui.driverCamera: true` or `initialCameraMode: 'driver'`.

8. Use `@inventure71/paddockjs/environment` for browser-free simulation/training imports.

9. Use `@inventure71/paddockjs/data` for CSS-free data/helper imports such as `DriverData`, `normalizeSimulatorDrivers`, `createProceduralTrack`, and speed conversion helpers.

10. Rebuild the host bundle and browser-smoke the host page, including theme toggles, selected-driver surfaces, and any composable mount roots.
