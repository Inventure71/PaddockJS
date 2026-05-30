# Data Helpers

Use the data subpath for CSS-free host tooling, server-side data preparation, public TypeScript types, and procedural track helpers.

```js
import {
  DriverData,
  createProceduralTrack,
  formatDriverNumber,
  normalizeSimulatorDrivers,
} from '@inventure71/paddockjs/data';
```

The data subpath does not import DOM, PixiJS, package CSS, or browser app code. It is the correct path for raw Node checks and build-time scripts.

## Driver And Entry Normalization

```js
const drivers = [
  { id: 'budget', name: 'Budget Buddy', color: '#ff2d55' },
];

const entries = [
  {
    driverId: 'budget',
    driverNumber: 71,
    timingName: 'Budget',
    driver: { pace: 52, racecraft: 74, aggression: 38, riskTolerance: 47, patience: 81, consistency: 86 },
    vehicle: { id: 'bb-01', name: 'BB-01', power: 48, braking: 72, aero: 55, dragEfficiency: 66, mechanicalGrip: 63, weightControl: 58, tireCare: 82 },
  },
];

const normalized = normalizeSimulatorDrivers(drivers, { entries });
```

Host websites pass the original `drivers` and `entries` to browser mounts. Tooling can use `normalizeSimulatorDrivers()` when it needs the resolved driver/car/team data before runtime.

## Procedural Track Helper

```js
const track = createProceduralTrack(4101, {
  profile: 'training-short',
  length: { minMeters: 900, maxMeters: 1800 },
  pitLane: { enabled: false },
});
```

Treat generated track definitions as read-only package data. If you need to experiment with mutable definitions, copy the data first.

See [Data Contract](data_contract.md) for full driver, entry, team, asset, rule, and callback shapes.
