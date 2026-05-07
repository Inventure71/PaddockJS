# Race Rules

This file documents the rules currently implemented by the simulator. If the race engine changes, update this file with the behavior change.

## Default Race Rules

Default rules are defined in `src/simulation/raceSimulation.js` as `DEFAULT_RULES`:

- DRS detection gap: `1` second.
- Safety car speed: `46` world units per second.
- Safety car lead distance: `122` world units.
- Safety car queue gap: `128` world units.
- Collision restitution: `0.18`.
- Standing start enabled by default.
- Start lights: `5`.
- Start light interval: `0.72` seconds.
- Lights-out hold: `0.78` seconds.

Race rules are normalized before the simulation starts. Hosts can choose a package ruleset preset with `rules.ruleset` or `rules.profile`:

- `paddock`: the simplified package default.
- `grandPrix2025`: a 2024-2025-era grand-prix-style preset.
- `fia2025`: an alias for `grandPrix2025` for hosts that prefer that name.
- `custom`: starts from the package defaults and applies host-provided module options.

The preset only chooses defaults. Explicit `rules.modules` values override the preset.

## Rule Modules

Advanced race behavior is organized under `rules.modules` so hosts can enable, disable, or tune each system independently:

```js
rules: {
  ruleset: 'fia2025',
  modules: {
    pitStops: {
      enabled: true,
      pitLaneSpeedLimitKph: 80,
      defaultStopSeconds: 2.8,
      doubleStacking: false,
    },
    tireStrategy: {
      enabled: true,
      compounds: ['S', 'M', 'H'],
      mandatoryDistinctDryCompounds: 2,
    },
    penalties: {
      enabled: true,
      stewardStrictness: 0.85,
      trackLimits: { strictness: 0.85, consequences: [{ type: 'time', seconds: 5 }] },
      collision: { strictness: 0.65, consequences: [{ type: 'time', seconds: 5 }] },
      tireRequirement: { strictness: 1, consequences: [{ type: 'time', seconds: 10 }] },
      pitLaneSpeeding: { strictness: 1, speedLimitKph: 80 },
    },
    weather: { enabled: false },
    reliability: { enabled: false },
    fuelLoad: { enabled: true },
  },
}
```

The current implementation normalizes and exposes all module config, records a penalty ledger, enforces collision penalties, track-limit penalties, and tire-requirement penalties. Pit stops, pit-lane routing/speeding, weather effects, reliability failures, and fuel-load performance effects are staged behind the module contract and are not fully simulated yet.

## Steward Strictness

Penalty subsections use `strictness` from `0` to `1` instead of a boolean:

- `1`: enforce close to the configured rule.
- `0`: do not enforce that subsection.
- Values between `0` and `1` increase the margin before a rule applies.

The simulator clamps invalid strictness values into the `0..1` range. `penalties.stewardStrictness` multiplies each subsection strictness, so hosts can make all stewards more lenient or stricter while still preserving per-rule tuning.

Supported penalty subsections:

- `trackLimits`
- `collision`
- `tireRequirement`
- `pitLaneSpeeding`

Track-limit enforcement uses the white line as the limit. The steward checks the two outside wheel points on the side of the excursion and records a violation only when both are beyond the white line by more than the strictness-adjusted margin. Touching the line, or having only one outside wheel beyond it, is not enough. Kerbs remain a different surface for grip/drag, but they no longer extend the legal track limit. Warning decisions are emitted as `track-limits` events with `decision: 'warning'`, `violationCount`, and `warningsBeforePenalty`; penalty decisions are also recorded in `snapshot.penalties` and emitted as `penalty` events in the same step.

Penalty decisions are recorded in `snapshot.penalties` and emitted as `penalty` events in the same step. Each entry includes the penalty type, driver id, strictness, penalty seconds, lap, timestamp, and rule-specific context. Multiple time penalties for the same driver are additive: two separate +5s entries produce `penaltySeconds: 10` on that car's snapshot and classification adjustment.

Each penalty subsection can define `consequences`. Supported consequences are:

- `{ type: 'warning' }`
- `{ type: 'time', seconds: 5 }`
- `{ type: 'time', seconds: 10 }`
- `{ type: 'time', seconds: 20 }`
- `{ type: 'driveThrough' }`

`penaltySeconds` is derived from time consequences for compatibility with timing/UI consumers. Rules without explicit consequences default to their existing time penalty seconds. At final classification, time consequences are added to the driver's finish time; the classified order is sorted by `finishTime + penaltySeconds`, with raw finish order used only as a tie-breaker.

## Race Modes

The simulator has three race-control modes:

- `pre-start`: cars are grid locked while start lights run.
- `green`: normal racing.
- `safety-car`: order is frozen and cars queue behind the safety car.

Safety car deployment is ignored during `pre-start`.

## Standing Start

When standing start is enabled:

- Cars begin in staggered grid slots.
- Cars stay locked until the start-light sequence releases them.
- Start lights increment over time.
- When lights go out, cars release and race mode becomes `green`.

When standing start is disabled through rules, race mode starts as `green`.

## Ordering And Timing

Race order is based on `raceDistance`, descending. Ties fall back to original driver index.

During safety car, order is frozen at deployment time. That prevents passing from reshuffling the timing tower while the safety car is active.

Timing history is sampled per car and used to estimate:

- Interval to the car ahead as `intervalAheadSeconds` / `gapAheadSeconds`.
- Cumulative gap to the leader as `leaderGapSeconds`.
- DRS detection timing.

The timing tower can switch at runtime between `Int` mode, which displays interval to the car ahead, and `Gap` mode, which displays cumulative gap to the leader. Timing continues to be calculated during pre-start, safety-car, and post-finish states even when the UI shows state labels such as `Grid`, `SC`, or `FIN`.

## Units

The race engine uses simulator units internally. `src/simulation/units.js` converts simulator distance and speed to public meter and km/h values. The current speed calibration maps the simulation maximum speed to an F1-like `330 km/h`; rendered car sprite dimensions are a visual scale and are not used as the physical distance scale.

## Laps

Lap is computed from each car's cumulative race distance over the track length. Total laps are provided by mount options and default to `10`.

Each track is automatically divided into three equal sectors. Sector and lap telemetry is recorded when a car's cumulative race distance crosses a sector boundary or start/finish boundary. Timing values are stored in seconds and exposed on each car snapshot as `lapTelemetry`.

Each car is marked `finished` when it reaches `track.length * totalLaps`. The first finisher becomes `winner`, receives classified rank `1`, and emits a `car-finish` event, but the race keeps running until every car has crossed the finish distance.

When all cars have finished, the simulator records `finishedAt` and final `classification`, emits a `race-finish` event, freezes order to the classified result, deploys the safety car, and switches race mode to `safety-car`. Finished cars keep circulating under safety-car behavior instead of hard-stopping. The current implementation does not yet implement pit stops, tire-compound obligations, or championship scoring.

## DRS

DRS behavior:

- DRS is disabled during safety car.
- Each track has DRS zones.
- A car latches into a DRS zone when it crosses that zone start.
- A car becomes DRS eligible if it was close enough to the car ahead at the relevant detection crossing.
- The current detection window is controlled by `drsDetectionSeconds`.
- When eligible inside the latched zone, `drsActive` becomes true.

Physics effect:

- Active DRS reduces drag through `src/simulation/vehiclePhysics.js`.
- The current drag multiplier is `0.42`.

Visual effect:

- Active DRS creates cyan trail segments behind the car in `src/app/F1SimulatorApp.js`.

## Safety Car

Safety car behavior:

- Deployment switches race mode to `safety-car`.
- Race order freezes.
- DRS state is cleared for all cars.
- Driver aggression is reduced.
- Cars target a queue slot behind the safety car.
- Timing values continue to be calculated, but gaps in the timing tower display as `SC` for non-leaders.

When safety car is cleared:

- Race mode returns to `green`.
- Frozen order is removed.
- Normal DRS and attacking behavior can resume.

## Driver AI

Driver control decisions live in `src/simulation/driverController.js`.

The AI has separate behavior for:

- Grid lock.
- Green-flag racing.
- Off-track rejoin.
- Safety-car queueing.

Green-flag behavior uses:

- Driver aggression.
- Racecraft.
- Risk tolerance.
- Patience.
- Current tire energy.
- Track curvature.
- Nearby traffic.
- Preferred and available lane offsets.

## Vehicle Physics

Vehicle physics live in `src/simulation/vehiclePhysics.js`.

The model includes:

- Steering target and steering rate.
- Engine force.
- Brake force.
- Drag force.
- Rolling resistance.
- Surface grip.
- Downforce grip.
- Tire condition.
- Yaw-rate saturation.
- Tire energy wear.

This is a browser simulation with physically grounded approximations. It is not exact F1 telemetry or a professional motorsport dynamics model.

## Surfaces

Track state can classify a car as on:

- `track`
- `kerb`
- `gravel`
- `grass`
- `barrier`

Surface affects grip, drag, and rolling resistance.

## Contact And Collision Handling

Collision handling uses:

- Oriented bounding-box overlap checks.
- Longitudinal spacing checks.
- Limited position correction.
- Contact velocity response.
- Yaw nudges.
- Contact cooldown.

The goal is believable traffic spacing and visible contact response, not full rigid-body simulation.

When collision stewarding is enabled, fresh contact is reviewed against impact severity, closing speed, and whether one car clearly hit another from behind. Low-speed/light contact is treated as a racing incident. For meaningful rear contact, the trailing car receives the only penalty and the entry records `aheadDriverId`, `atFaultDriverId`, `impactSpeedKph`, and the configured impact-speed threshold. If rear-contact responsibility is unclear, both involved cars receive shared-fault collision penalties with `sharedFault: true`. Collision penalties are independent from the existing physical contact response.

When tire-requirement stewarding is enabled, a finished car is reviewed once against `tireStrategy.mandatoryDistinctDryCompounds`. Because pit stops are not implemented yet, cars currently only have their starting compound in `usedTireCompounds`; a strict two-compound rule will therefore penalize cars at finish until tire-change mechanics are added.

## Known Non-Goals For Now

These are not currently implemented:

- Pit stops.
- Tire compound strategy.
- Fuel load strategy.
- Weather.
- Penalties.
- Mechanical failures.
- Race finish ceremony.
- Multiplayer controls.
- Official timing rules, licensing, or real-world team identities.
