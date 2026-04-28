# System Specs

## Purpose

PaddockJS mounts an interactive F1-style race simulator into a host webpage. The package owns the simulator UI, PixiJS renderer, bundled simulator assets, simulation core, default demo data, and public mount API.

The host website owns only:

- The root DOM element where the simulator mounts.
- The driver/project list.
- Optional driver/car pairing entries.
- Optional display/config overrides.
- `onDriverOpen(driver)` navigation behavior.

## Public API

Main import:

```js
import { mountF1Simulator } from '@inventure71/paddockjs';
```

Mount call:

```js
const simulator = await mountF1Simulator(root, {
  drivers,
  entries,
  onDriverOpen,
  seed,
  trackSeed,
  totalLaps,
  initialCameraMode,
  title,
  kicker,
  backLinkHref,
  backLinkLabel,
  showBackLink,
  ui,
  assets,
});
```

Returned controller:

```js
{
  destroy(),
  restart(nextOptions),
  selectDriver(driverId),
  setSafetyCarDeployed(deployed),
  getSnapshot(),
}
```

## Required Behavior

- Mounting creates the simulator shell inside the provided root.
- The host does not need to provide simulator assets.
- The host passes data, not internal DOM.
- `onDriverOpen(driver)` is the navigation boundary.
- The simulator must stay interactive after being installed through `npm install ../PaddockJS`.
- The package must build correctly through a browser bundler that supports JavaScript modules, CSS imports, and image imports.
- The simulation should remain deterministic for the same seed, track seed, drivers, entries, and rules.
- The renderer should target a paced 60 FPS simulation/render loop.

## Current Visible Features

- Timing tower with position, car icon, timing code, gap, and tire compound.
- Race canvas rendered with PixiJS.
- Procedural track rendering with asphalt texture and DRS overlays.
- Driver selection from cars and timing tower rows.
- Camera modes: overview, leader, selected, show all.
- Zoom controls.
- FPS readout.
- Start lights.
- Safety car toggle.
- Restart button.
- Selected-car telemetry.
- Car overview panel.
- Project/race data lower-third.
- Intermittent project radio quotes.
- `Open project` button driven by `onDriverOpen(driver)`.

## Runtime Requirements

- Browser environment with DOM APIs.
- A host build tool that handles CSS and image imports. Vite is the currently verified bundler.
- `pixi.js` available through the package dependency graph.

Raw Node imports are not a supported runtime check because the package imports CSS and image assets. Verify through a browser bundler and host page instead.

## Verification

Run from this package:

```bash
npm run check
```

Expected:

- All Vitest tests pass.
- `npm pack --dry-run` succeeds and includes source files plus bundled assets.

Run from the portfolio host:

```bash
npm install ../PaddockJS
npm run check
```

Expected:

- PaddockJS tests pass through the host script.
- The host F1 bundle builds.
- Browser smoke shows shell, canvas, driver rows, FPS readout, and working `Open project` navigation.
