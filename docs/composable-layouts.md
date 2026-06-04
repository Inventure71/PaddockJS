# Composable Layouts

Use composable layouts when a host page wants to place package-owned simulator pieces in separate DOM roots. The host owns placement and surrounding page layout; PaddockJS still owns generated markup, CSS variables, race state, timing state, and component behavior.

## Create One Controller

```js
import { createPaddockSimulator } from '@inventure71/paddockjs';

const simulator = createPaddockSimulator({
  drivers,
  entries,
  onDriverOpen(driver) {
    if (driver.link) window.location.href = driver.link;
  },
});
```

Keep one controller per race runtime. Mount the surfaces you need, then start it:

```js
simulator.mountRaceControls(document.getElementById('sim-controls'));
simulator.mountCameraControls(document.getElementById('sim-camera-controls'));
simulator.mountSafetyCarControl(document.getElementById('sim-safety-car'));
simulator.mountRaceCanvas(document.getElementById('sim-race'), {
  includeTimingTower: true,
  includeRaceDataPanel: true,
  timingTowerVerticalFit: 'scroll',
});
simulator.mountRaceDataPanel(document.getElementById('sim-race-data'));

await simulator.start();
```

Controller methods are the canonical composable style. The standalone mount helper exports exist for compatibility, but new host code should prefer `simulator.mountRaceCanvas(root)` and the matching controller methods.

## Available Surfaces

- `mountRaceControls(root)`
- `mountCameraControls(root)`
- `mountSafetyCarControl(root)`
- `mountTimingTower(root)`
- `mountRaceCanvas(root, options)`
- `mountTelemetryPanel(root)`
- `mountTelemetryCore(root)`
- `mountTelemetrySectors(root)`
- `mountTelemetrySectorBanner(root)`
- `mountTelemetryLapTimes(root)`
- `mountTelemetrySectorTimes(root)`
- `mountRaceTelemetryDrawer(root, options)`
- `mountCarDriverOverview(root)`
- `mountRaceDataPanel(root)`

`mountRaceCanvas()` can embed the timing tower and race-data lower-third when the host wants a single package-owned race window. `mountRaceTelemetryDrawer()` mounts a larger workbench with top controls, race canvas, timing tower, safety-car control, and telemetry drawer.

## Lifecycle

```js
await simulator.start();

simulator.selectDriver('budget');
simulator.setTimingGapMode('leader');
simulator.setPitLaneOpen(false);

simulator.restart({ trackSeed: 5051 });
simulator.destroy();
```

Use `restart(nextOptions)` for race/data/seed changes. Use `setTheme()`, `setThemeMode()`, or `syncThemeFrom()` for presentation changes so the race does not reset.

Browser expert mode changes are not a casual restart setting. Expert mode changes ticker ownership and freezes the visual simulator until host code steps it, so only enable it intentionally for policy playback or debugging.

## Sizing

Each mounted root receives PaddockJS component scope classes and package CSS variables. Hosts may size the outer roots, but timing-board width, broadcast proportions, camera safe area, drawer behavior, lower-thirds, focus styles, and touch targets remain package-owned.

Use `includeTimingTower: true` when the race canvas should own the timing tower placement. Use `timingTowerVerticalFit: 'scroll'` to keep a fixed race height with a scrolling timing list, or `'expand-race-view'` when the race window may grow to fit the tower.
