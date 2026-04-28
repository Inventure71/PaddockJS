# Data Contract

This file documents the data that host websites pass into PaddockJS.

## Mount Options

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

- `src/driverData.js`
- `src/vehicleData.js`

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
  showTimingTower: true,
  showTelemetry: true,
  showRaceDataPanel: true,
}
```

These options are part of the config surface, but not every UI flag is fully used by the shell yet. If a UI flag becomes functional, update this doc and add tests or browser verification.

## Returned Controller

```js
const simulator = await mountF1Simulator(root, options);
```

Controller methods:

- `destroy()`: removes listeners, destroys PixiJS runtime, clears the host root.
- `restart(nextOptions)`: restarts the simulation with merged options.
- `selectDriver(driverId)`: selects and focuses a driver.
- `setSafetyCarDeployed(deployed)`: toggles safety car state.
- `getSnapshot()`: returns the latest simulation snapshot.
