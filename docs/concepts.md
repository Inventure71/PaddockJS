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

## Driver

A driver is the host-facing entity shown as a race entry. In the portfolio use case, each driver maps to a project.

Core fields:

- `id`
- `name`
- `color`
- `link`
- `raceData`

Drivers can also define display fields such as `icon`, `code`, `tire`, and `driverNumber`.

## Entry

An entry is the pairing between a driver and a car setup. Entries live in the `entries` option and are matched by `driverId`.

Entry responsibilities:

- Driver number.
- Timing name.
- Driver ratings.
- Vehicle ratings.

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

The track is a closed sampled centerline with width, kerbs, runoff, DRS zones, and surface classification.

The package supports:

- A default named track.
- Procedural tracks from `trackSeed`.

## Progress

Progress is the wrapped distance around the current lap.

Race distance is cumulative and can increase beyond one lap. Ranking uses race distance, not wrapped progress.

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
- Ordered cars with telemetry and setup data.

## Render Snapshot

The render snapshot interpolates moving entities between physics ticks for smoother rendering.

`src/renderSnapshot.js` handles interpolation for cars and the safety car.

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
