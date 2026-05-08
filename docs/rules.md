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
      maxConcurrentPitLaneCars: 3,
      minimumPitLaneGapMeters: 20,
      doubleStacking: false,
      tirePitRequestThresholdPercent: 50,
      tirePitCommitThresholdPercent: 30,
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

The current implementation normalizes and exposes all module config, records a penalty ledger, enforces collision penalties, track-limit penalties, and tire-requirement penalties, creates/renders pit-lane geometry for every track, treats pit-lane asphalt, working-lane service areas, and garage boxes as legal drivable surfaces, and runs a first automated pit-stop pass when `pitStops.enabled` is true. Pit-lane speeding penalties, weather effects, reliability failures, and fuel-load performance effects are staged behind the module contract and are not fully simulated yet.

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

Track-limit enforcement uses the white line as the legal edge. The steward checks the four wheel contact patches and records a violation only when all four patches are fully beyond the same side of the white line by more than the strictness-adjusted margin. Touching the line, riding a kerb, or having only some wheels beyond the line is not enough. Kerbs remain a different surface for grip/drag, but they are inside track limits. Warning decisions are emitted as `track-limits` events with `decision: 'warning'`, `violationCount`, and `warningsBeforePenalty`; penalty decisions are also recorded in `snapshot.penalties` and emitted as `penalty` events in the same step. The active-excursion state remains continuous, so staying fully outside for several frames counts as one excursion until at least one wheel returns inside/legal.

The built-in driver AI is expected to respect that same white-line rule through normal control inputs. Its racing-line planner keeps a centerline comfort margin for the car footprint, and the controller progressively lifts, applies mild braking when needed, and steers back inward when the car approaches the legal edge. This does not let the car defy physics; it only changes when the default AI chooses to brake, coast, and steer. Kerbs still allow normal recovery speed rather than gravel-style stopping behavior.

Pit-lane surfaces are legal road for track-limit purposes. `pit-entry`, `pit-lane`, `pit-exit`, and `pit-box` track states set `inPitLane: true`, so ray sensors, runoff response, and the track-limit steward do not treat normal pit entry, service, or exit as off-track excursions.

Penalty decisions are recorded in `snapshot.penalties` and emitted as `penalty` events in the same step. Each entry includes the penalty type, driver id, strictness, status, penalty seconds, pending service conversion seconds, lap, timestamp, and rule-specific context. Multiple time penalties for the same driver are additive: two separate +5s entries produce `penaltySeconds: 10` on that car's snapshot and classification adjustment.

Each penalty subsection can define `consequences`. Supported consequences are:

- `{ type: 'warning' }`
- `{ type: 'time', seconds: 5 }`
- `{ type: 'time', seconds: 10 }`
- `{ type: 'time', seconds: 20 }`
- `{ type: 'driveThrough', conversionSeconds: 20 }`
- `{ type: 'stopGo', seconds: 10, conversionSeconds: 30 }`
- `{ type: 'positionDrop', positions: 1 }`
- `{ type: 'gridDrop', positions: 3 }`
- `{ type: 'disqualification' }`

Penalty status is part of the simulation model. Immediate consequences use `applied`; drive-through and stop-go consequences start as `issued`, can become `served` through the controller API or pit-stop service, can be `cancelled`, and convert to `applied` time penalties if still unserved when final classification is built. During a pit stop, eligible penalties are served before tire work starts: applied time penalties add their seconds as a stationary hold, stop-go penalties add their configured `seconds`, and drive-through penalties are marked served by the pit-lane traversal without adding stationary hold time.

`penaltySeconds` is derived from applied time consequences for compatibility with timing/UI consumers. Rules without explicit consequences default to their existing time penalty seconds. If a time or stop-go penalty is served in the pit box, those seconds are spent before the tire change and the penalty no longer contributes to final adjusted time. At final classification, remaining time consequences and unserved service conversions are added to the driver's finish time; the classified order is sorted by `finishTime + penaltySeconds`, with raw finish order used only as a tie-breaker. Position-drop consequences then move classified drivers down by the configured number of places, and disqualified drivers are classified after non-disqualified finishers. Grid-drop consequences apply during `pre-start` by moving the driver down the grid.

## Race Modes

The simulator has three race-control modes:

- `pre-start`: cars are grid locked while start lights run.
- `green`: normal racing.
- `safety-car`: order is frozen and cars queue behind the safety car.

Safety car deployment is ignored during `pre-start`.

## Standing Start

When standing start is enabled:

- Cars begin in staggered grid slots.
- Procedural tracks normalize the start/finish area into an explicit straight so the grid and immediate launch area are not placed on a curved segment.
- Cars stay locked until the start-light sequence releases them.
- Start lights increment over time.
- When lights go out, cars release and race mode becomes `green`.

When standing start is disabled through rules, race mode starts as `green`.

## Ordering And Timing

Race order is based on `raceDistance`, descending. Ties fall back to original driver index.

During safety car, order is frozen at deployment time. That prevents passing from reshuffling the timing tower while the safety car is active.

The simulation builds hidden timing lines around every track at an F1-style mini-sector spacing target of roughly `150m..200m`. Timing history is sampled per car and timing-line crossing timestamps are used to calculate:

- Interval to the car ahead as `intervalAheadSeconds` / `gapAheadSeconds`.
- Direct same-lead-lap gap to the leader as `leaderGapSeconds`.
- Whole-lap deficits as `intervalAheadLaps` / `gapAheadLaps` and `leaderGapLaps`.
- DRS detection timing.

Seconds gaps are the difference between when two cars crossed the same timing line. The race engine falls back to timing-history interpolation only before the cars have a shared timing-line sample. The timing tower can switch at runtime between `Int` mode, which displays interval to the car ahead, and `Gap` mode, which displays direct gap to the leader. When the relevant gap is one or more whole laps, the tower shows `+1`, `+2`, and so on instead of a misleading seconds estimate. Timing continues to be calculated during pre-start, safety-car, and post-finish states even when the UI shows state labels such as `Grid`, `SC`, or `FIN`.

## Units

The race engine uses simulator units internally. `src/simulation/units.js` converts simulator distance and speed to public meter and km/h values. Public timer, lap-time, sector-time, gap-time, penalty-time, and service-countdown values are seconds. Public distance values with a `Meters` suffix are meters. The current speed calibration maps the simulation maximum speed to an F1-like `330 km/h`; rendered car sprite dimensions are a visual scale and are not used as the physical distance scale.

## Laps

Lap is computed from each car's cumulative race distance over the track length. Total laps are provided by mount options and default to `10`.

Each track is automatically divided into three equal sectors. Sector and lap telemetry is recorded when a car's cumulative race distance crosses a sector boundary or start/finish boundary. Completed current-lap sector split times are exposed as `currentSectors`, while `liveSectors` keeps the active sector's elapsed time updated before the boundary is crossed. `sectorProgress` is recomputed every snapshot as the live S1/S2/S3 fill state for the current lap, so sector-map UI does not derive progress from completed split state. Timing values are stored in seconds and exposed on each car snapshot as `lapTelemetry`.

Each car is marked `finished` when it reaches `track.length * totalLaps`. The first finisher becomes `winner`, receives classified rank `1`, and emits a `car-finish` event, but the race keeps running until every car has crossed the finish distance.

When all cars have finished, the simulator records `finishedAt` and final `classification`, emits a `race-finish` event, freezes order to the classified result, deploys the safety car, and switches race mode to `safety-car`. Finished cars keep circulating under safety-car behavior instead of hard-stopping. The current implementation does not yet implement championship scoring.

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

Tire energy can degrade to 1%. The vehicle physics layer converts tire energy into a nonlinear grip factor, so degradation has a visible performance cost across the full 100% to 1% range while still leaving a damaged car controllable enough to return to the pits.

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
- `pit-entry`
- `pit-lane`
- `pit-exit`
- `pit-box`
- `gravel`
- `grass`
- `barrier`

Surface affects grip, drag, and rolling resistance.

Surface physics is wheel-based. `src/simulation/wheelSurface.js` classifies each wheel contact patch against the track model and the car uses the worst current surface for physics: `barrier > gravel > grass > kerb > pit-box > pit-lane > pit-entry/pit-exit > track`. Normal main-track running uses an analytic signed-offset fast path from cached wheel geometry, while pit-lane and pit-connector edge cases use full patch sampling. One wheel on gravel slows the car with gravel behavior even if the other three wheels are on asphalt. In addition, `vehiclePhysics.js` compares left-side and right-side wheel resistance and applies a small capped yaw-rate bias toward the slower side, so asymmetric gravel/grass/kerb contact can tug the car toward the dirty side without becoming a full tire-force simulation. One wheel on kerb reports `kerb` and applies kerb-level grip/drag without causing a track-limit violation by itself. Pit entry, pit lane, pit exit, and pit-box surfaces remain legal drivable surfaces.

When pit stops are enabled, each team is assigned one shared service area in the working lane plus two garage boxes. Driver pairs share the service area, and the service area, queue slot, and garage boxes inherit the team color from `driver.team.color` when present, otherwise the lead driver's color. The current automatic stop plan distributes pit calls across available race laps as bounded pit trains, then lets opportunistic cars join the entry only when fewer than `pitStops.maxConcurrentPitLaneCars` are active and the nearest active pit-lane car is at least `pitStops.minimumPitLaneGapMeters` ahead; committed cars enter at the next pit-entry window and can queue in the working lane if their team service area is busy. Built-in AI cars also request stops from tire condition: below `pitStops.tirePitRequestThresholdPercent` they request `pitIntent: 1`, and below `pitStops.tirePitCommitThresholdPercent` they request `pitIntent: 2`. Expert-controlled cars do not receive those tire-threshold automatic calls; their model or host must request the stop with `pitIntent`. Hosts and expert actions can change a pending stop with `pitIntent`: `0` clears the pending call, `1` stays active until a free-enough pit-entry window appears, and `2` commits to entering at the next pit-entry window even if capacity or gap checks would block mode `1`. The same request may include a target compound, either through `setPitIntent(driverId, intent, targetCompound)` or expert action `pitCompound`; invalid compounds are rejected. Pit intent and target compound are locked while the car is entering, queued, servicing, or exiting, and intent resets to `0` after pit exit. Completed stops can be re-armed by later tire condition or host intent, so pit stops are not one-use per race. Safety-car mode does not block pit intent. Closed pit-lane race-control state keeps pending calls on track until `setPitLaneOpen(true)`, while red-flag state freezes cars and closes the effective pit lane until cleared. If the gap is too small for mode `1`, the following car stays on the main track and retries later rather than being forced to stop in the lane. Allowed cars steer through a forward main-track approach into the pit-entry road, slow to the configured limiter speed before the main pit-lane start, follow the main fast lane, pass through the team-colored queue point, hold for any pit-served penalties, hold for the resolved tire-service time, change to the requested compound or default alternate compound, add that compound to `usedTireCompounds`, then steer back to the racing surface through `pit-exit`. While a car is stationary in service, the browser renderer shows a small countdown above it: red `+Ns` for pit-served penalty hold time and yellow `Ns` for normal pit-service time. The queue point is a rolling gate when the active service area is free, so the car continues into service without a full stop. If a team-mate is already servicing or still exiting from the active service area, the arriving car targets the queue point behind that service area, waits without obstructing the main fast lane, then follows a short queue-release route only after the active service area is physically clear; this keeps both the queue stop and the move into service continuous instead of snapping the car between slots. `pitStops.variability.enabled` optionally adjusts service time from `team.pitCrew.speed`, `team.pitCrew.consistency`, and `team.pitCrew.reliability`; `pitStops.variability.perfect: true` forces `pitStops.defaultStopSeconds` for training. The pit limiter applies only on the straight main pit lane and working lane between the lane start and lane end; the pit-entry connector road and pit-exit connector road are legal pit-lane surfaces but are not speed-limited by `pitStops.pitLaneSpeedLimitKph`, although automatic entry routing caps connector overspeed so worn-tire cars can still reach the limiter and assigned service area.

## Contact And Collision Handling

Collision handling uses:

- Shared vehicle geometry from `src/simulation/vehicleGeometry.js`.
- A body collision hull for car-vs-car contact.
- Four wheel/contact-patch shapes for surface and track-limit state, not for car-vs-car contact.
- Track-progress candidate pruning before narrow-phase checks.
- SAT overlap checks for body/body contact.
- Swept broadphase and conservative substep checks so fast cars cannot tunnel through each other between fixed steps.
- Limited position correction.
- Contact velocity response.
- Yaw nudges.
- Contact cooldown.

The collision footprint intentionally matches the visible main car body instead of the transparent sprite rectangle. Empty sprite corners and wheel-only overlap do not count as car-vs-car contact. Longitudinal protection can only assist after swept body geometry confirms a real shape contact; it cannot invent a collision from spacing alone. Contact events expose `firstShapeId`, `secondShapeId`, `contactType`, `depth`, and `timeOfImpact` for debug views and host callbacks.

When collision stewarding is enabled, fresh contact is reviewed against impact severity, closing speed, and whether one car clearly hit another from behind. Low-speed/light contact is treated as a racing incident. For meaningful rear contact, the trailing car receives the only penalty and the entry records `aheadDriverId`, `atFaultDriverId`, `impactSpeedKph`, and the configured impact-speed threshold. If rear-contact responsibility is unclear, both involved cars receive shared-fault collision penalties with `sharedFault: true`. Collision penalties are independent from the existing physical contact response.

When tire-requirement stewarding is enabled, a finished car is reviewed once against `tireStrategy.mandatoryDistinctDryCompounds`. Cars start with their initial tire in `usedTireCompounds`; completed automatic pit stops add the changed compound, so a strict two-compound rule can be satisfied by the current pit-stop module.

## Known Non-Goals For Now

These are not currently implemented:

- Strategic pit-call timing beyond the current first automatic stop.
- Double stacking and pit-crew conflicts.
- Pit-lane speeding enforcement.
- Manual tire strategy selection beyond changing to the first different configured compound.
- Fuel load strategy.
- Weather.
- Mechanical failures.
- Race finish ceremony.
- Multiplayer controls.
- Official timing rules, licensing, or real-world team identities.
