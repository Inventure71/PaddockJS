# System Specs

## Purpose

PaddockJS mounts an interactive F1-style race simulator into a host webpage. The package owns the simulator UI, PixiJS renderer, bundled simulator assets, simulation core, default demo data, and public mount API.

The host website owns only:

- The root DOM element where the simulator mounts.
- The driver/project list.
- Optional driver/car pairing entries.
- Optional display/config overrides.
- `onDriverOpen(driver)` navigation behavior.

## Public API

Main import:

```js
import {
  createPaddockSimulator,
  mountF1Simulator,
} from '@inventure71/paddockjs';
```

Headless expert environment import:

```js
import {
  createPaddockEnvironment,
  createPaddockDriverControllerLoop,
  createRolloutRecorder,
  runEnvironmentEvaluation,
} from '@inventure71/paddockjs/environment';
```

The environment subpath is the only public headless training import. It must stay free of DOM, PixiJS, CSS, and browser app dependencies.
`createProgressReward()` is published from the same subpath only as non-canonical demo reward code for examples and smoke tests. It must remain optional and replaceable; environment stepping must continue to work with a custom `reward(context)` callback or no reward callback. Reward callbacks are user-owned formulas over package-owned facts, including neutral per-driver `metrics` and `info.drivers[driverId]` episode state.
Ray observations expose track-transition distance and car distance per ray. Track transitions use `kind: 'exit'` when the ray starts on track and reaches the border, `kind: 'entry'` when the ray starts off track and reaches the road again, and `kind: null` with max distance when no transition is visible. Track-position, surface, pit-lane, and ray fallback queries can use an internal non-enumerable track query index built with the track model and enabled for compact training-style environment runs; this changes runtime cost, not public observation shapes.
The package must not own model training, model persistence, model registries, or trained policy behavior. The supported contract is: external code reads observations, returns normalized actions, and advances either the headless environment or browser expert mode.
The shared expert runtime exposes `getActionSpec()` and `getObservationSpec()` so external code can inspect controlled drivers, action ranges, sensor layout, nearby-car limits, track lookahead fields, and the versioned vector schema before connecting a model. Environment reset may apply deterministic scenario placement presets or explicit placement/traffic layouts; model steps may not mutate position and still use normalized actions only. Neutral rollout recording, deterministic evaluation metrics, and the JSON worker protocol are environment utilities, not training algorithms.
`createPaddockDriverControllerLoop({ runtime, controller, actionRepeat })` is the shared public controller orchestrator for browser playback and JavaScript training-style loops. `runtime` may be browser expert mode or a headless environment, and `controller.decideBatch(context)` is called once per policy step for all controlled drivers in stable spec order. The loop caches `actionSpec` and `observationSpec`, reuses the active observation payload, supports async controllers, forwards actions through the normal `step(actions)` API, and repeats each decision for `actionRepeat` runtime frames. It does not load checkpoints, run neural networks, parse model formats, compute rewards, or mutate vehicle state.

All-in-one mount call:

```js
const simulator = await mountF1Simulator(root, {
  drivers,
  entries,
  onDriverOpen,
  seed,
  trackSeed,
  totalLaps,
  physicsMode,
  initialCameraMode,
  preset,
  title,
  kicker,
  backLinkHref,
  backLinkLabel,
  showBackLink,
  ui,
  theme,
  assets,
  onLoadingChange,
  onReady,
  onError,
  onDriverSelect,
  onRaceEvent,
  onLapChange,
  onRaceFinish,
  expert,
});
```

Composable mount call:

```js
const simulator = createPaddockSimulator({
  drivers,
  entries,
  onDriverOpen,
  seed,
  trackSeed,
  totalLaps,
  initialCameraMode,
});

simulator.mountRaceControls(controlsRoot);
simulator.mountCameraControls(cameraControlsRoot);
simulator.mountSafetyCarControl(safetyCarRoot);
simulator.mountTimingTower(timingRoot);
simulator.mountRaceCanvas(canvasRoot, {
  includeRaceDataPanel: true,
  includeTimingTower: true,
  timingTowerVerticalFit: 'scroll',
});
simulator.mountTelemetryPanel(telemetryRoot);
simulator.mountTelemetryCore(coreTelemetryRoot);
simulator.mountTelemetrySectors(sectorGraphRoot);
simulator.mountTelemetrySectorBanner(sectorBannerRoot);
simulator.mountTelemetryLapTimes(lapTimesRoot);
simulator.mountTelemetrySectorTimes(sectorTimesRoot);
simulator.mountRaceTelemetryDrawer(raceWorkbenchRoot, {
  timingTowerVerticalFit: 'expand-race-view',
  raceDataTelemetryDetail: true,
});

await simulator.start();
simulator.setPitIntent('budget', 2, 'H'); // committed automatic pit request with target tire
const pitIntent = simulator.getPitIntent('budget');
const targetCompound = simulator.getPitTargetCompound('budget');
simulator.setPitLaneOpen(false);
simulator.setRedFlagDeployed(true);
```

Standalone helper functions are also exported for host code that prefers function calls:

```js
mountRaceControls(root, simulator);
mountCameraControls(root, simulator);
mountSafetyCarControl(root, simulator);
mountTimingTower(root, simulator);
mountRaceCanvas(root, simulator, {
  includeRaceDataPanel: true,
  includeTimingTower: true,
  timingTowerVerticalFit: 'scroll',
});
mountTelemetryPanel(root, simulator);
mountTelemetryCore(root, simulator);
mountTelemetrySectors(root, simulator);
mountTelemetrySectorBanner(root, simulator);
mountTelemetryLapTimes(root, simulator);
mountTelemetrySectorTimes(root, simulator);
mountRaceTelemetryDrawer(root, simulator, {
  raceDataTelemetryDetail: true,
});
mountCarDriverOverview(root, simulator);
mountRaceDataPanel(root, simulator);
```

Returned controller:

```js
{
  // Included on composable controllers only:
  mountRaceControls(root),
  mountCameraControls(root),
  mountSafetyCarControl(root),
  mountTimingTower(root),
  mountRaceCanvas(root, { includeRaceDataPanel, includeTimingTower, includeTelemetrySectorBanner, timingTowerVerticalFit }),
  mountTelemetryPanel(root),
  mountTelemetryCore(root),
  mountTelemetrySectors(root),
  mountTelemetrySectorBanner(root),
  mountTelemetryLapTimes(root),
  mountTelemetrySectorTimes(root),
  mountRaceTelemetryDrawer(root, { timingTowerVerticalFit, drawerInitiallyOpen, raceDataTelemetryDetail }),
  mountRaceDataPanel(root),
  start(),

  // Included on both APIs:
  destroy(),
  restart(nextOptions),
  selectDriver(driverId),
  setSafetyCarDeployed(deployed),
  setRedFlagDeployed(deployed),
  setPitLaneOpen(open),
  setPitIntent(driverId, intent, targetCompound),
  getPitIntent(driverId),
  getPitTargetCompound(driverId),
  getSimulationSpeed(),
  servePenalty(penaltyId),
  cancelPenalty(penaltyId),
  callSafetyCar(),
  clearSafetyCar(),
  toggleSafetyCar(),
  getSnapshot(),
  expert,
}
```

## Required Behavior

- Mounting creates the simulator shell inside the provided root.
- Composable mounting can place controls, timing tower, canvas, telemetry, car/driver overview, and race-data panels into separate host roots.
- Composable mounting can also place camera controls and a safety-car button into separate host roots while keeping package-owned markup.
- Composable mounting can embed the timing tower directly inside the race canvas with `mountRaceCanvas(root, { includeTimingTower: true })`.
- The race canvas is required before `start()` because PixiJS needs a canvas host.
- Timing tower, telemetry, controls, and race-data panels are optional from a runtime safety perspective; omitted panels simply do not render their readouts.
- Timing tower entries are fixed rows stacked from the top of the timing list. Row vertical position must be based on rank/index, never distributed by available height or total entry count.
- Timing tower entries display team icons. The tower can switch at runtime between interval-to-car-ahead timing and direct gap-to-leader timing. Seconds gaps are calculated from hidden timing-line crossings, and whole-lap deficits display as `+N`.
- Snapshots expose calibrated display units through `speedKph`, `distanceMeters`, and `gapMeters`; internal physics remains in simulator units. Public timer, lap-time, sector-time, gap-time, penalty-time, and service-countdown values are seconds.
- Snapshots expose automatic three-sector track metadata through `track.sectors` and per-car lap/sector timing through `car.lapTelemetry`, including completed current-lap sector splits before the active sector, live active-sector elapsed time, per-sector progress, and sector performance classes for overall-best, personal-best, and slower completed sector times. Future-sector timing/progress entries are cleared so banner and sidebar telemetry cannot display stale split values from another lap or state.
- Entries can include optional `team` metadata. Team color defaults to car color when omitted.
- Mounted package surfaces show a package-owned red start-light loading overlay until `start()` finishes PixiJS, asset, control, and initial readout initialization.
- `preset` is a preset-first API. Presets are resolved before explicit host overrides so hosts can use `dashboard`, `timing-overlay`, `compact-race`, or `full-dashboard` as a starting point and still override specific `ui` or `theme` fields.
- `theme` is the public sizing/color contract. It maps to package CSS variables for `accentColor`, `greenColor`, `yellowColor`, `timingTowerMaxWidth`, and `raceViewMinHeight`.
- `initialCameraMode` accepts `'overview'`, `'leader'`, `'selected'`, `'show-all'`, or `'pit'`; invalid values fall back to `'leader'`. The overview camera frames the active generated track bounds with package-owned padding and pit-lane extent. The pit camera frames the operational `track.pitLane` lane, boxes, service areas, and queue areas instead of the longer entry/exit access roads, zooms out when needed to keep that pit-lane work area inside the active race-view safe area, and its control is hidden/disabled if the active track has no pit lane. Zoom buttons and wheel zoom work in every camera mode, including overview, show-all, and pit, but cannot zoom farther out than the active track frame.
- Camera controls default to external placement so they do not cover the race view. They can still be embedded in the race canvas by setting `ui.cameraControls: 'embedded'`, externally mounted, or omitted with `false`. Generated camera controls include a `Mute banners` toggle that is off by default and temporarily suppresses project/radio lower-thirds while active.
- Telemetry surfaces are detached package components: core scalar readouts, sector graph, broadcast sector banner, lap-time table, and sector-time table. The broadcast sector banner shows the selected car identity, uses the selected car color for its frame/label, and keeps sector performance colors inside the sector bars. It is an explicitly mounted independent surface, not the default telemetry-drawer lower-third. `mountTelemetryPanel()` is the stack template around those detached pieces, owns vertical scrolling when constrained, and `ui.telemetryModules` controls which pieces appear in stack/drawer templates.
- `mountRaceTelemetryDrawer()` creates a package-owned race workbench: external top controls, race canvas, embedded timing tower, lower-third banner, top steward message, safety-car control, and a right-side telemetry drawer. The top row holds camera controls, banner mute, safety car, and telemetry toggle outside the canvas. Pass `{ raceDataTelemetryDetail: true }` when the drawer lower-third should include compact project telemetry detail. The drawer opens smoothly, takes width from the race view instead of overlaying it, is inert/hidden to interaction when closed, and embeds the same `telemetry-stack` component used by standalone telemetry panels.
- The FPS readout can be shown or hidden with `ui.showFps`.
- `ui.layoutPreset: 'left-tower-overlay'` is a package-owned preset that creates a left broadcast gutter inside the race view, places the timing tower there at the same width as the default timing-board column, frames the PixiJS camera around the remaining usable race area, and keeps camera controls and start lights out of the tower area. In the combined shell, project and radio lower-thirds stay inside the race window while being allowed to cover the timing sidebar.
- `ui.raceDataBanners.initial` controls the starting lower-third (`'project'`, `'radio'`, or `'hidden'`), and `ui.raceDataBanners.enabled` controls which lower-third types can appear. The runtime banner mute state temporarily disables project/radio lower-thirds without changing these configured allow-lists.
- Project and radio lower-third pills include a package-owned top-right close button that dismisses the current pill early. The next pill appears only through normal driver selection or radio scheduling.
- `ui.raceDataBannerSize` controls lower-third sizing: `'custom'` keeps the default CSS-variable-driven banner size for host tuning, while `'auto'` uses the race space to the right of the timing board when wide enough and overlaps the timing board only when space is constrained.
- `ui.raceDataTelemetryDetail` adds compact S1/S2/S3 sector detail to the project lower-third while keeping radio mode unchanged.
- `ui.timingTowerVerticalFit` controls vertical tower behavior in the combined overlay preset: `'expand-race-view'` grows the race window to fit the tower, while `'scroll'` crops the tower area and scrolls timing rows inside it. The same values are accepted as `mountRaceCanvas()` options when `includeTimingTower` embeds the tower in the race canvas.
- Hosts may scale the whole mounted simulator through the container. The horizontal proportions inside package-owned presets are not public API and should not be configurable through raw width or ratio options. The camera reads the current canvas dimensions so wider or taller host windows reveal more of the race view without needing host-owned camera math, and the renderer keeps grass coverage beyond the simulated world so deep zoom-out does not show host background. The timing tower has a package-owned max width because overly wide timing boards degrade readability; standalone hosts can constrain vertical height through the mount container and let the timing entries scroll internally. Mobile and narrow embeds are handled by package CSS: timing boards stack full-width when they no longer work as side gutters, camera controls stay in external control rows when mounted, and full-width timing boards do not reserve horizontal camera gutter space.
- The host does not need to provide simulator assets.
- The host passes data, not internal DOM.
- Host driver IDs and entry `driverId` values must be unique. Entries may omit `driverNumber`; provided numbers must be unique.
- `totalLaps` is normalized to a finite positive integer before simulation so invalid input cannot produce zero-lap, negative-lap, or non-finite snapshots.
- `physicsMode` accepts `'arcade'` and `'simulator'`. The default is `'arcade'` to preserve existing hosts. `'simulator'` is opt-in and keeps cars controlled only through steering, throttle, brake, and pit intent while enabling traction-budget limits, steering scrub, velocity-heading slip, surface-specific grip/drag, and simulator telemetry. Snapshots expose `physicsMode` plus per-car `lateralG`, `longitudinalG`, `gripUsage`, `slipAngleRadians`, `tractionLimited`, `stabilityState`, and the latest `appliedControls`.
- `restart(nextOptions)` can change race data and deterministic seeds such as `trackSeed`, but it does not support changing asset URLs. Asset changes require `destroy()` and a fresh mount because PixiJS texture loading is an initialization boundary.
- `onDriverOpen(driver)` is the navigation boundary.
- Lifecycle callbacks are optional: `onLoadingChange`, `onReady`, `onError`, `onDriverSelect`, `onRaceEvent`, `onLapChange`, and `onRaceFinish`. Host callback failures are routed to `onError` when possible and must not stop the simulator loop.
- Race completion is part of the simulation snapshot. Cars receive individual `finished`, `finishTime`, `finishRank`, `status: 'waved-flag'`, `raceStatus: 'waved-flag'`, `wavedFlag`, `penaltySeconds`, `adjustedFinishTime`, and `classifiedRank` values as they cross the finish distance. Destroyed/out-of-race cars expose `dnf`, `dnfReason`, `dnfAt`, and `dnfOrder`, appear below active cars in timing, and do not block race completion while they remain DNF. The first finisher sets a provisional `raceControl.winner`; already-finished cars remain frozen in provisional finish order while the remaining cars complete the distance. Final `raceControl.classification` and `raceControl.finished` are set only after every race participant has finished or is DNF. DNF entries are included after finishers with no finish time. A DNF car restored before final classification re-enters live timing and must finish; after final classification, resurrection does not reopen the race. Final classification converts unserved drive-through and stop-go penalties into configured time, sorts finishers by `finishTime + penaltySeconds`, applies position-drop and disqualification consequences, then race control switches to `safety-car`, the final order freezes to the classified result, and the field keeps circulating under safety-car behavior.
- Race rules support package presets and custom module config. Supported rulesets are `paddock`, `grandPrix2025`, `fia2025`, and `custom`. Advanced modules include pit stops, tire strategy, tire degradation, penalties, weather, reliability, and fuel load. The current simulator normalizes all module config, creates/renders track-owned pit-lane geometry on an explicit start/finish straight, treats pit-lane asphalt, working-lane service areas, and garage boxes as legal drivable surfaces, runs automatic bounded pit-train entry/service/exit through the main fast lane and shared team service areas when pit stops are enabled, lets host/expert pit calls choose a target tire compound, uses the team queue point as a rolling gate when the service area is free, queues a second team car behind the active service area and moves it forward through a queue-release route only after the active service area is physically clear, keeps pit-route approach speed bounded until the final queue/service capture instead of crawling through open route, optionally varies pit-service time from team pit-crew stats with a perfect-training override, supports pit-lane open/closed state plus red flags, requests pit stops from configurable tire-energy thresholds, applies nonlinear tire-grip degradation down to 1% unless `rules.modules.tireDegradation.enabled` is `false`, applies the pit speed limiter only on the main pit lane/working lane, enforces pit-lane speeding on speed-limited pit-lane parts but not on entry/exit connectors, keeps the safety car about `55m` ahead of the leader with compact `22m` frozen-order queue slots, lets the built-in driver AI ride kerbs, attack, defend, and recover through normal steering/throttle/brake decisions with short controller-state commitments for rejoin and attack decisions, and enforces stewarded penalties for collisions, track limits, pit-lane speeding, and tire requirements.
- Penalty subsections use `strictness` from `0` to `1`, not only boolean enablement. `strictness: 0` means the subsection is not enforced; `strictness: 1` applies the configured rule margin. Steward decisions are exposed as `penalty` events and as top-level `snapshot.penalties`. Penalty entries include normalized consequences and lifecycle status. Immediate consequences apply time, grid, position, or disqualification effects directly; drive-through and stop-go consequences remain issued until served, cancelled, or converted at final classification.
- The browser UI can opt into top steward messages with `ui.penaltyBanners` and timing-row penalty badges with `ui.timingPenaltyBadges`. Steward messages render track-limit warning events and penalty decisions from the simulation; time-penalty messages put the penalty seconds in a large left chip and use penalty-colored backgrounds, while warnings use warning-colored backgrounds. Timing-row `!` badges are rendered only from `snapshot.penalties`; warning events do not count. UI code must not recalculate steward decisions.
- The simulator must stay interactive after being installed through `npm install @inventure71/paddockjs`.
- The package must build correctly through a browser bundler that supports JavaScript modules, CSS imports, and image imports.
- The simulation should remain deterministic for the same seed, track seed, drivers, entries, and rules.
- When `trackSeed` is omitted in a browser mount, the simulator creates a fresh procedural circuit for that mount. Explicit `trackSeed` values are deterministic and cached by seed plus resolved generation options for repeated mounts. Cached procedural definitions are immutable; callers that import `createProceduralTrack(seed, options)` should treat the returned definition as read-only and clone it before custom mutation. `trackGeneration` forwards the same procedural options used by `createProceduralTrack(seed, options)`: `profile`, `length`, `startStraight`, `pitLane`, `shape`, `validation`, and `attempts`. The `race` profile preserves the default full circuit with pit lane; `training-short`, `training-medium`, and `training-technical` are smaller pitless presets intended for training or demos. Explicit option fields override profile defaults after the profile is resolved. Procedural generation traces seeded connected region boundaries, smooths and warps them into centerline controls, then rejects circuits with excessive local heading jumps, turn accumulation, self-intersections, poor clearance, invalid length, or weak shape variation.
- The renderer should target a paced 60 FPS simulation/render loop.
- The render loop should pause while the race canvas is offscreen or the document is hidden, then resume without catching up the elapsed hidden time. Layout measurements needed for overlay camera safe areas should be cached between resize/layout invalidations. Runtime DOM updates should skip unchanged text/markup so visible embeds do not rewrite stable readouts every frame.
- Restart and rerender paths must destroy replaced PixiJS display children while preserving shared loaded textures.
- Restart supports race/data/seed changes but does not support asset URL changes or browser expert mode changes. Texture loading and ticker ownership are mount-time boundaries; hosts must destroy and mount again to change either boundary.
- Expert environment code can create a headless `createPaddockEnvironment()` from the `@inventure71/paddockjs/environment` subpath. It requires explicit `controlledDrivers`, accepts normalized actions `{ steering, throttle, brake }` plus optional `pitIntent` and `pitCompound`, advances only through `step(actions)`, and returns environment-loop JavaScript results with `observation`, `reward`, `metrics`, `terminated`, `truncated`, `done`, `events`, `state`, and `info`. `steering` is an absolute normalized steering target: `-1` points at maximum left, `0` points at center, `1` points at maximum right, and intermediate values are percentages of the maximum steering angle; the vehicle integrator rate-limits motion toward that target instead of snapping the wheel. `info.drivers[driverId]` exposes per-driver `terminated`, `truncated`, `endReason`, `episodeStep`, and `episodeId` for batched loops. Controlled drivers do not receive tire-threshold automatic pit calls; they request automatic pit service through `pitIntent`, may choose the target tire through `pitCompound`, and observe pit-lane/service/race-control state in `observation[driverId].object.self` and `.race`. `pitIntent: 0` is a no-op clear request and does not fail when pit stops are disabled. `self.onTrack` follows wheel-level legality, so track, kerb, and legal pit-lane/box surfaces are on-track while gravel/grass/barrier are off-track. Barrier-wall contact in both physics modes is measured against the rendered wall's inner face; contact marks the car destroyed/DNF, removes it from active collision/sensor participation, emits a `car-destroyed` event, and terminates that driver's episode with `endReason: 'destroyed'`. Reset is still an episode-boundary `resetDrivers()` call. Environment scenarios may set reset positions with `preset`, `placements`, and relative `traffic`; `resetDrivers(placements)` may reset selected controlled drivers between episodes without recreating the whole simulation. After placement, selected cars are classified by the same runoff/barrier rules before observations are returned, so cars already inside terminal barrier space report destroyed metrics and stable miss-valued rays instead of doing alive-car far-out ray scans. Both scenario placement and `resetDrivers()` are setup data, not policy actions. `participantInteractions` may make real physics cars non-colliding, sensor-hidden, non-blocking for pit occupancy, or excluded from race order, but those cars still live in `snapshot.cars` and move only through normal physics/control APIs. The `batch-training` profile is non-colliding, sensor-hidden, pit-non-blocking, excluded from race order, and still rendered. `replayGhosts` are separate trajectory-driven entities in `snapshot.replayGhosts`; they are visual/reference overlays and never enter car physics, timing, pit, order, or penalty systems. Replay ghosts are sensor-hidden unless their own sensor flags explicitly opt them into ray or nearby observations.
- Controller loop code should use `createPaddockDriverControllerLoop()` instead of duplicating browser/headless stepping. Its controller context groups observations by controlled driver id, includes `orderedObservations` for direct batch tensor assembly, exposes `previousActions`, metrics, events, cached specs, and reset-driver ids, and keeps per-driver resets as controller reset hooks when the runtime supports `resetDrivers()`.
- Expert ray sensors originate from the controlled car center. The default compact set is `[-135, -60, -20, 0, 20, 60, 135, 180]`, giving forward, side, and rear awareness while staying small. Rays detect track edges against the actual track geometry and detect car hits by ray-to-car-footprint intersection. Hosts may opt into per-ray lengths, predefined layouts such as `driver-front-heavy`, and surface-aware channels for kerb and illegal surface detection; those channels are computed only when requested and use analytic acceleration plus indexed ray-boundary intersections across the legal surface and nearby off-track recovery band before falling back to indexed sampled geometry where needed. Barrier walls are rendered/physical terminal boundaries, not model-facing ray targets; active ray objects, vectors, schemas, and visualizations must not expose a `barrier` ray channel. Ray `precision` defaults to `driver`, which is the active model-facing sensor contract; `debug` precision is only for explicitly labeled diagnostics. `observation.profile: 'physical-driver'` exposes local driver-like yaw, contact-patch, boundary, richer ray, and opponent-radar senses while omitting default lookahead samples unless explicitly configured. `observation.output` can be `full`, `vector`, or `object`, `includeSchema: false` omits repeated schema payloads, and `vectorType: 'float32'` returns typed vector buffers for high-throughput JavaScript loops. `result.stateOutput` can be `full`, `minimal`, or `none`; `none` returns `state: null` and is intended for loops that rely on observations, metrics, and info instead of full snapshots.
- Track surface bands are single-source geometry. Rendering derives visible gravel, runoff, and barrier offsets from the same track widths used by wheel surfaces and ray surface hits: road edge, kerb outer edge, gravel outer edge, runoff outer edge, and barrier wall width. New code must not add independent magic offsets for these bands.
- Browser expert mode is opt-in with `expert: { enabled: true, controlledDrivers, frameSkip }`. When enabled, the returned controller exposes `expert.reset()`, `expert.step(actions)`, `expert.getObservation()`, and `expert.getState()`.
- Browser expert mode wraps the same `RaceSimulation` instance that the visual canvas renders. It must not create a parallel simulation for the same mount.
- Browser expert mode disables automatic ticker-driven simulation advancement. The visual canvas updates only after explicit expert `reset()` or `step(actions)` calls.
- Browser expert mode may opt into `expert.visualizeSensors: true` or `expert.visualizeSensors: { rays: true }`. When enabled, ray sensors render in the race canvas world layer from the selected controlled car by default, using the same observation result produced by explicit expert steps. The overlay draws a separate colored marker for each detected active channel on each ray, including road-edge, kerb, illegal surface, and car hits. Barrier walls are visible track geometry, not ray-hit markers, and browser components must not reintroduce a barrier ray label. Hosts may request `visualizeSensors: { rays: true, drivers: 'all' }` for the heavier all-controlled-car overlay or pass an explicit driver id list. Every model-facing sense follows this rule: the model receives the active environment observation, and Policy Runner/expert visualization displays that same observation instead of recomputing a more precise or different browser-only value. Extra diagnostics must be clearly separated from model senses.

## Current Visible Features

- Timing tower with position, team icon, timing code, interval/gap switch, and tire compound.
- Race canvas rendered with PixiJS.
- Procedural track rendering with asphalt texture and DRS overlays.
- Driver selection from cars and timing tower rows.
- Camera modes: overview, leader, selected, show all.
  Overview is a closer static circuit view centered on the world; show all is the mode that dynamically fits the active pack.
- Zoom controls.
- FPS readout.
- Start lights.
- Safety car toggle.
- External safety-car control through controller methods and optional mounted button.
- Restart button.
- Detached selected-car telemetry components for scalar readouts, sector progress graph, lap timing table, and sector timing table.
- Car/driver overview panel with a center visual, linked stat cells, and a Car/Driver toggle.
- Project/race data lower-third.
- Intermittent project radio quotes.
- Race-finish winner banner and final top-three classification.
- `Open project` button driven by `onDriverOpen(driver)`.

## Runtime Requirements

- Browser environment with DOM APIs.
- A host build tool that handles CSS and image imports. Vite is the currently verified bundler.
- `pixi.js` available through the package dependency graph.

Raw Node imports of the package root are not a supported runtime check because the browser component entry imports CSS and image assets. The `@inventure71/paddockjs/environment` subpath is the supported browser-free import path for headless JavaScript training.
The repository starter loop is executable with `node examples/train-basic-policy.mjs`. It imports the public environment subpath and self-contained example data from `examples/trainingData.mjs`. It is a dependency-free example that trains/evaluates a tiny policy against the environment contract; it is not a packaged Gymnasium bridge or a recommended final RL algorithm. The package exposes a JSON-serializable worker protocol wrapper so external processes can bridge to the JavaScript environment without PaddockJS choosing Python, Gymnasium, PettingZoo, model storage, or training infrastructure.

## Verification

Run from this package:

```bash
npm run check
```

Expected:

- Fast Vitest tests pass in the normal local gate. Slow characterization tests run under `npm run check:release`.
- `npm pack --dry-run` succeeds and includes source files plus bundled assets.
- A packed tarball installs and builds inside a fresh temporary Vite consumer app.
- The tracked showcase host builds.
- The quick Chromium browser smoke verifies showcase canvas rendering, overflow constraints, and one public API action. The release browser smoke verifies the desktop/mobile matrix, package-panel overflow constraints, public API buttons, and visual policy-runner stepping across generation and race configurations.

Run from a browser host that consumes the published package:

```bash
npm install @inventure71/paddockjs@latest
npm run check
```

Expected:

- The host bundle builds with PaddockJS resolved from npm.
- Browser smoke shows shell, canvas, driver rows, FPS readout, and working `Open project` navigation.
