# PaddockJS

This folder is the extractable F1 simulator component. It owns the simulator source, bundled simulator assets, CSS, demo data, and the public mount API.

## Documentation

Start with [docs/index.md](docs/index.md) for system specs, rules, concepts, data contracts, and architecture notes.

## API

All-in-one mount:

```js
import { mountF1Simulator } from '@inventure71/paddockjs';

const simulator = await mountF1Simulator(document.getElementById('sim-root'), {
  drivers: [
    {
      id: 'budget',
      name: 'Budget Buddy',
      color: '#ff2d55',
      link: '/project_details/project-budget-buddy.html',
      raceData: ['AI finance coach', 'Python + LLM', 'Budget guardrails'],
    },
  ],
  entries: [
    {
      driverId: 'budget',
      driverNumber: 71,
      timingName: 'Budget',
      driver: { pace: 52, racecraft: 74, aggression: 38, riskTolerance: 47, patience: 81, consistency: 86 },
      vehicle: { id: 'budget-bb01', name: 'BB-01 Ledger', power: 48, braking: 72, aero: 55, dragEfficiency: 66, mechanicalGrip: 63, weightControl: 58, tireCare: 82 },
    },
  ],
  onDriverOpen(driver) {
    window.location.href = driver.link;
  },
});
```

Composable mount:

```js
import { createPaddockSimulator } from '@inventure71/paddockjs';

const simulator = createPaddockSimulator({
  drivers,
  entries,
  onDriverOpen(driver) {
    window.location.href = driver.link;
  },
});

simulator.mountRaceControls(document.getElementById('sim-controls'));
simulator.mountCameraControls(document.getElementById('sim-camera-controls'));
simulator.mountSafetyCarControl(document.getElementById('sim-safety-car'));
simulator.mountTimingTower(document.getElementById('sim-timing'));
simulator.mountRaceCanvas(document.getElementById('sim-race'), {
  includeRaceDataPanel: true,
});
simulator.mountTelemetryPanel(document.getElementById('sim-telemetry'));
simulator.mountCarDriverOverview(document.getElementById('sim-overview'));

await simulator.start();
```

`drivers` is the host-owned project/pilot list. `entries` is the optional driver/car pairing sheet. The car/driver overview uses the existing driver and vehicle rating components from each entry. Driver and vehicle entries can also include `customFields` as extra label/value metadata. Assets, including the default car image and generic driver helmet, are bundled by default, so the host website does not need to provide simulator images or textures.

The returned object supports:

- `destroy()`
- `restart(nextOptions)`
- `selectDriver(driverId)`
- `setSafetyCarDeployed(deployed)`
- `callSafetyCar()`
- `clearSafetyCar()`
- `toggleSafetyCar()`
- `getSnapshot()`

Useful UI options:

```js
ui: {
  layoutPreset: 'left-tower-overlay',
  cameraControls: 'external',
  showFps: false,
  telemetryIncludesOverview: false,
  raceDataBanners: {
    initial: 'project',
    enabled: ['project', 'radio'],
  },
  raceDataBannerSize: 'auto',
  timingTowerVerticalFit: 'expand-race-view',
}
```

`layoutPreset: 'left-tower-overlay'` creates a left broadcast gutter inside the race view, frames the camera around the remaining race area, and places the timing tower in that gutter without covering camera controls. The project/radio lower-third stays inside the race window and can intentionally render over the timing sidebar instead of shrinking around it. Composable hosts should pass `{ includeRaceDataPanel: true }` to `mountRaceCanvas()` when they want that lower-third clipped and layered by the race window; `mountRaceDataPanel()` remains available for hosts that intentionally want the banner as a standalone surface. `raceDataBanners.initial` selects the starting banner state (`'project'`, `'radio'`, or `'hidden'`), while `raceDataBanners.enabled` chooses which banner types may appear. `raceDataBannerSize: 'auto'` uses the race space to the right of the timing board when it is wide enough and falls back to the full lower-third overlap when it is not; `'custom'` preserves the default CSS-variable-driven lower-third size for hosts that want to tune their own banner geometry. `timingTowerVerticalFit: 'expand-race-view'` lets the race window grow tall enough for the tower; `'scroll'` keeps the race window height and scrolls the timing list inside the cropped tower. The host controls the overall component size through its container; the internal tower-to-race-view proportion is package-owned and is not a supported configuration option. `cameraControls: 'external'` moves view controls out of the canvas so hosts can mount them with `mountCameraControls()`. `showFps: false` hides the FPS readout. `telemetryIncludesOverview: false` keeps telemetry text-only so hosts can mount `mountCarDriverOverview()` separately.
