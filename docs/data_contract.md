# Data Contract

This file documents the data that host websites pass into PaddockJS.

## Mount Options

All-in-one API:

```js
mountF1Simulator(root, {
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

Composable API:

```js
const simulator = createPaddockSimulator({
  drivers,
  entries,
  onDriverOpen,
  seed,
  trackSeed,
  totalLaps,
  initialCameraMode,
  ui,
  assets,
});

simulator.mountRaceCanvas(canvasRoot);
await simulator.start();
```

Additional optional components:

```js
simulator.mountRaceControls(controlsRoot);
simulator.mountCameraControls(cameraControlsRoot);
simulator.mountSafetyCarControl(safetyCarRoot);
simulator.mountTimingTower(timingRoot);
simulator.mountTelemetryPanel(telemetryRoot);
simulator.mountRaceDataPanel(raceDataRoot);
```

## Required Options

`drivers` is required and must be a non-empty array.

Each driver must have:

```js
{
  id: 'budget',
  name: 'Budget Buddy',
  color: '#ff2d55',
}
```

## Recommended Driver Shape

```js
{
  id: 'budget',
  name: 'Budget Buddy',
  color: '#ff2d55',
  link: '/project_details/project-budget-buddy.html',
  icon: 'BB',
  code: 'BUD',
  tire: 'M',
  raceData: ['AI finance coach', 'Python + LLM', 'Budget guardrails'],
}
```

Fields:

- `id`: stable unique ID used for matching entries and selection.
- `name`: display name.
- `color`: car/team color.
- `link`: optional host-owned navigation target.
- `icon`: short display mark in timing/telemetry.
- `code`: fallback timing code.
- `tire`: `S`, `M`, or `H`.
- `raceData`: short project/radio lines shown in the UI.

## Entry Shape

Entries are optional. If omitted, defaults are used.

```js
{
  driverId: 'budget',
  driverNumber: 71,
  timingName: 'Budget',
  driver: {
    pace: 52,
    racecraft: 74,
    aggression: 38,
    riskTolerance: 47,
    patience: 81,
    consistency: 86,
  },
  vehicle: {
    id: 'budget-bb01',
    name: 'BB-01 Ledger',
    power: 48,
    braking: 72,
    aero: 55,
    dragEfficiency: 66,
    mechanicalGrip: 63,
    weightControl: 58,
    tireCare: 82,
  },
}
```

Entries match drivers by `driverId`.

## Rating Rules

Driver and vehicle ratings use `0-100`.

- `0`: minimum.
- `50`: neutral.
- `100`: maximum.

Rating conversion lives in:

- `src/data/driverData.js`
- `src/data/vehicleData.js`

## Callback Contract

PaddockJS does not directly own host navigation. The host should provide:

```js
onDriverOpen(driver) {
  window.location.href = driver.link;
}
```

The callback receives the normalized driver object. If the host wants modals, routing, analytics, or external tabs, it should implement that inside this callback.

## Asset Overrides

Assets are optional because PaddockJS bundles defaults.

Override shape:

```js
assets: {
  car: '/custom/car.png',
  carOverview: '/custom/car-overview.png',
  safetyCar: '/custom/safety-car.png',
  broadcastPanel: '/custom/broadcast-panel.png',
  f1Logo: '/custom/logo.png',
  trackTextures: {
    asphalt: '/custom/asphalt.png',
  },
}
```

Do not require hosts to copy PaddockJS default assets into their own project. If defaults are missing, fix the package.

## UI Options

Current UI options:

```js
ui: {
  layoutPreset: 'standard',
  cameraControls: 'embedded',
  showFps: true,
  showTimingTower: true,
  showTelemetry: true,
  showRaceDataPanel: true,
}
```

- `layoutPreset`: `'standard'` or `'left-tower-overlay'`. The overlay preset creates a left broadcast gutter inside the race canvas, places the timing tower in that gutter, and keeps the canvas overlays and camera framing in the remaining race-view area.
- `cameraControls`: `'embedded'`, `'external'`, or `false`. Embedded controls render inside the race canvas. External controls are mounted with `mountCameraControls(root)`. `false` leaves camera controls unrendered, though callers can still drive selection through controller methods.
- `showFps`: controls whether the race canvas renders the FPS readout.
- `showTimingTower`, `showTelemetry`, `showRaceDataPanel`: reserved component visibility flags for host layout decisions.

No UI option exists for raw timing-tower width, max width, or horizontal ratio. Host pages can scale the whole simulator by changing the mount container, but package-owned layout presets keep their internal proportions inside PaddockJS.

## Returned Controller

```js
const simulator = await mountF1Simulator(root, options);
```

Controller methods:

- `destroy()`: removes listeners, destroys PixiJS runtime, clears the host root.
- `restart(nextOptions)`: restarts the simulation with merged options.
- `selectDriver(driverId)`: selects and focuses a driver.
- `setSafetyCarDeployed(deployed)`: toggles safety car state.
- `callSafetyCar()`: deploys the safety car.
- `clearSafetyCar()`: releases the safety car.
- `toggleSafetyCar()`: switches safety car deployment based on the current snapshot.
- `getSnapshot()`: returns the latest simulation snapshot.

Composable controllers additionally expose:

- `mountRaceControls(root)`: renders the top control/header component.
- `mountCameraControls(root)`: renders package-owned camera mode and zoom controls outside the race canvas.
- `mountSafetyCarControl(root)`: renders a package-owned safety-car button that binds to the same race-control state as other safety buttons.
- `mountTimingTower(root)`: renders the timing tower component.
- `mountRaceCanvas(root)`: renders the PixiJS canvas host, optional FPS, start lights, and optionally embedded camera controls. This is required before `start()`.
- `mountTelemetryPanel(root)`: renders selected-car telemetry and car overview.
- `mountRaceDataPanel(root)`: renders the project/race-data lower-third as a separate component.
- `start()`: initializes PixiJS, binds mounted controls, and starts the simulation loop.

Mount component roots before calling `start()`. If a component is not mounted, the runtime skips that UI surface instead of requiring hidden placeholder DOM.
