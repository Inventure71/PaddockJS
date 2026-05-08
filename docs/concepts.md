# Concepts

## Host

The host is the website or app that installs PaddockJS. The host provides data and chooses what happens when a driver/project is opened.

Example host responsibilities:

- Install `@inventure71/paddockjs`.
- Add a root element.
- Pass `drivers`.
- Optionally pass `entries`.
- Implement `onDriverOpen(driver)`.

## Mounted Simulator

The mounted simulator is the runtime returned by `mountF1Simulator()`.

It owns:

- Generated DOM shell.
- PixiJS application.
- Race simulation instance.
- Event listeners.
- Camera state.
- Timing and telemetry UI.

It exposes lifecycle methods such as `destroy()` and `restart()`.

## Composable Simulator

The composable simulator is the runtime created by `createPaddockSimulator()`.

It lets a host mount package-owned UI surfaces into separate roots:

- Race controls.
- Timing tower.
- Race canvas.
- Telemetry panel.
- Race-data panel.

The host controls placement and layout. PaddockJS still owns the markup, CSS classes, event bindings, assets, and runtime behavior.

## Simulator Controller

The simulator controller is the object returned by both public APIs.

The all-in-one controller starts immediately after `mountF1Simulator()`.

The composable controller has a setup phase:

- Mount the desired components.
- Mount the race canvas.
- Call `start()`.

After startup, both controller styles expose runtime methods such as `restart()`, `selectDriver()`, `setSafetyCarDeployed()`, `getSnapshot()`, and `destroy()`.

Pit-stop hosts can also call `setPitIntent(driverId, 0 | 1 | 2)`. `0` means no pending pit request, `1` means take the next pit entry only if it is free, and `2` means keep the request active until the automatic pit-stop sequence completes.

## Driver

A driver is the host-facing entity shown as a race entry. In the portfolio use case, each driver maps to a project.

Core fields:

- `id`
- `name`
- `color`
- `link`
- `raceData`

Drivers can also define display fields such as `icon`, `code`, `tire`, `driverNumber`, and `customFields`.

## Entry

An entry is the pairing between a driver, car setup, and optional team metadata. Entries live in the `entries` option and are matched by `driverId`.

Entry responsibilities:

- Driver number.
- Timing name.
- Driver ratings.
- Vehicle ratings.
- Optional team object with `id`, `name`, `color`, and `icon`.
- Driver and vehicle rating components for the car/driver overview panel.
- Optional driver and vehicle `customFields` for extra overview metadata.

## Team

A team is entry-level metadata used for race identity and future pit-lane behavior. The timing tower uses the team icon in its team column. Team color defaults to the car color when omitted.

## Driver Ratings

Driver ratings are `0-100` values converted into behavior inputs:

- `pace`
- `racecraft`
- `aggression`
- `riskTolerance`
- `patience`
- `consistency`

`50` is neutral.

## Vehicle Ratings

Vehicle ratings are `0-100` values converted into physical setup values:

- `power`
- `braking`
- `aero`
- `dragEfficiency`
- `mechanicalGrip`
- `weightControl`
- `tireCare`

`50` is neutral.

## Track

The track is a closed sampled centerline with width, kerbs, runoff, DRS zones, pit-lane geometry, and surface classification.

The package supports:

- A default named track for low-level simulation callers that provide neither a track nor a track seed.
- Procedural browser tracks from generated or explicit `trackSeed` values.

Browser mounts that omit `trackSeed` create a fresh procedural track for that mount. Passing `trackSeed` makes the generated circuit deterministic; repeated procedural seeds are cached within the page runtime. Generated circuits use validated template-based spline controls rather than a pure oval fallback, so failed candidates retry into another shaped layout instead of degrading into a circular track.

Every built track also exposes a deterministic `pitLane` near the start/finish straight. The pit lane has an entry before the start line, an exit after it, explicit lane-aligned entry/exit road centerlines, a straight main fast lane, a parallel working lane, 10 shared team service areas, and 20 unused garage boxes arranged as 10 team pairs. Pit-lane asphalt, service areas, and garage boxes are legal drivable surfaces for sensors, runoff handling, and track-limit stewarding. When the pit-stop module is enabled, cars automatically form bounded pit trains when there is enough rolling gap, brake to the limiter by the main lane start, follow the fast lane, stage in their assigned colored team queue spot before rolling into the team service area, change tire compound, and return through the exit. Team-mates share one service area; every car passes through the queue spot first, and a second team car waits there without blocking the fast lane. Tire condition can request a stop automatically: below the configured request threshold the car asks to pit if free, and below the commit threshold it keeps retrying until served. The speed limiter is active on the straight main pit lane/working lane, not on the entry and exit connector roads.

## Progress

Progress is the wrapped distance around the current lap.

Race distance is cumulative and can increase beyond one lap. Ranking uses race distance, not wrapped progress.

## Sectors

Every built track is divided into three equal sectors, published as `track.sectors`. Sector timing is derived from cumulative race distance crossing those sector boundaries, not from UI state.

## Snapshot

A snapshot is the read-only state returned by the race simulation and exposed through `getSnapshot()`.

Snapshots include:

- Time.
- World dimensions.
- Track model.
- Race control mode.
- Safety car state.
- Current rules.
- Events from the last step.
- Penalty ledger.
- Ordered cars with telemetry and setup data.

Per-car timing exposes both interval to the car ahead and cumulative gap to the leader. Per-car `lapTelemetry` exposes current lap, current sector, current/last/best lap times, current/last/best sector times, sector progress, and sector performance status. Sector performance status marks completed sector times as `overall-best`, `personal-best`, or `slower`, which drives the purple/green/yellow timing colors in sector graphs and tables. Per-car speed and distance display fields are calibrated through the simulator unit conversion helpers instead of treating rendered world units as meters.

## Rulesets And Modules

A ruleset is a named preset for race-rule defaults. `paddock` is the package default, `grandPrix2025` / `fia2025` are 2024-2025-era grand-prix-style presets, and `custom` is for host-owned behavior.

A rule module is an advanced subsystem under `rules.modules`, such as pit stops, tire strategy, penalties, weather, reliability, or fuel load. Presets set defaults, but explicit module config wins.

Penalty strictness is a stewarding value from `0` to `1`. `0` means the penalty subsection is not enforced. `1` means the subsection applies close to its configured rule margin.

A penalty consequence is the result attached to a steward decision. Supported consequences are warning, time, drive-through, stop-go, position-drop, grid-drop, and disqualification payloads. `penaltySeconds` is the sum of applied time consequences for timing, UI consumers, and final classification ordering; unserved drive-through and stop-go penalties convert into applied time when the final classification is calculated.

## Render Snapshot

The render snapshot interpolates moving entities between physics ticks for smoother rendering.

`src/rendering/renderSnapshot.js` handles interpolation for cars and the safety car.

## Race Data Panel

The race data panel is the lower-third UI shown over the track.

It has two modes:

- Selected project mode.
- Project radio quote mode.

Project opening is callback-based through `onDriverOpen(driver)`.

## Assets

PaddockJS bundles default simulator assets:

- F1 logo.
- Car sprite.
- Safety car sprite.
- Broadcast panel surface.
- Asphalt texture.

Hosts can override assets, but they should not need to provide them.
