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

When all cars have finished, the simulator records `finishedAt` and final `classification`, emits a `race-finish` event, freezes order to the classified result, deploys the safety car, and switches race mode to `safety-car`. Finished cars keep circulating under safety-car behavior instead of hard-stopping. The current implementation does not yet implement pit stops, penalties, or championship scoring.

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
