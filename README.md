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
simulator.mountRaceCanvas(document.getElementById('sim-race'));
simulator.mountTelemetryPanel(document.getElementById('sim-telemetry'));
simulator.mountRaceDataPanel(document.getElementById('sim-race-data'));

await simulator.start();
```

`drivers` is the host-owned project/pilot list. `entries` is the optional driver/car pairing sheet. Assets are bundled by default, so the host website does not need to provide simulator images or textures.

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
}
```

`layoutPreset: 'left-tower-overlay'` creates a left broadcast gutter inside the race view, frames the camera around the remaining race area, and places the timing tower in that gutter without covering camera controls or the lower-third. The host controls the overall component size through its container; the internal tower-to-race-view proportion is package-owned and is not a supported configuration option. `cameraControls: 'external'` moves view controls out of the canvas so hosts can mount them with `mountCameraControls()`. `showFps: false` hides the FPS readout.
