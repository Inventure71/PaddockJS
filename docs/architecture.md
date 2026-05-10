# Architecture

## Package Boundary

PaddockJS is the simulator package. A host website imports it and passes data.

The package owns:

- Simulator source.
- Bundled assets.
- CSS.
- DOM shell generation.
- PixiJS renderer.
- Simulation rules and physics.
- Demo data.
- Tests.

The host owns:

- Project-specific driver data.
- Navigation behavior.
- Page placement.
- Host build and deployment.

## Main Flow

All-in-one flow:

```txt
host page
  -> mountF1Simulator(root, options)
  -> resolveF1SimulatorOptions(options)
  -> normalizeSimulatorDrivers(drivers, entries)
  -> createF1SimulatorShell(options)
  -> new F1SimulatorApp(shell, resolvedOptions)
  -> createRaceSimulation(...)
  -> PixiJS render loop + DOM readout updates
```

Composable flow:

```txt
host page
  -> createPaddockSimulator(options)
  -> resolveF1SimulatorOptions(options)
  -> simulator.mountRaceControls(controlsRoot)
  -> simulator.mountCameraControls(cameraControlsRoot)
  -> simulator.mountSafetyCarControl(safetyCarRoot)
  -> simulator.mountTimingTower(timingRoot)
  -> simulator.mountRaceCanvas(canvasRoot, { includeRaceDataPanel })
  -> simulator.mountTelemetryCore(coreTelemetryRoot)
  -> simulator.mountTelemetrySectors(sectorGraphRoot)
  -> simulator.mountTelemetrySectorBanner(sectorBannerRoot)
  -> simulator.mountTelemetryLapTimes(lapTimesRoot)
  -> simulator.mountTelemetrySectorTimes(sectorTimesRoot)
  -> simulator.mountRaceTelemetryDrawer(raceWorkbenchRoot) [optional template alternative]
  -> simulator.mountRaceDataPanel(raceDataRoot) [optional standalone alternative]
  -> simulator.start()
  -> new F1SimulatorApp(compositeRoot, resolvedOptions)
  -> PixiJS render loop + DOM readout updates
```

Headless environment flow:

```txt
training script
  -> import from @inventure71/paddockjs/environment
  -> createPaddockEnvironment(options)
  -> resolveEnvironmentOptions(options)
  -> createRaceSimulation(...)
  -> applyEnvironmentScenario(...) for reset-only placements
  -> env.reset()
  -> env.step(actions)
  -> resolveActionMap(actions)
  -> RaceSimulation.step(...) repeated by frameSkip
  -> buildEnvironmentObservation(...)
  -> optional reward(context)
```

The environment runtime consumes per-step events directly from the simulation during `frameSkip` and builds the full public snapshot once for the returned result. This keeps `reset()` / `step()` semantics unchanged while avoiding repeated full car, wheel, penalty, and track serialization inside one environment action.

Browser expert mode reuses the same environment runtime around the visual app's existing `RaceSimulation` instance. When `expert.enabled` is true, the visual ticker does not advance simulation time automatically; `simulator.expert.reset()` and `simulator.expert.step(actions)` are the only simulation-advance entry points.

## Public Entry

`src/index.js` is the public package entry.

Responsibilities:

- Import CSS.
- Export package API and data helpers.
- Validate the root element.
- Resolve options.
- Create the DOM shell.
- Construct and initialize `F1SimulatorApp`.
- Return the controller methods.
- Re-export the composable mount API.

`src/index.js` does not export the headless environment API. Training and automation code imports `@inventure71/paddockjs/environment`, which resolves to `src/environment/index.js`.

`src/environment/` owns the browser-free expert environment:

- `index.js` and `index.d.ts` expose the public subpath API.
- `runtime.js` owns environment-loop `reset()`, `step(actions)`, `getObservation()`, and `getState()` around an injected race-simulation host.
- `options.js` validates `controlledDrivers`, scenario participants, reset placement config, frame skip, action policy, sensor config, and episode limits.
- `actions.js` maps normalized public controls onto simulator steering/throttle/brake controls plus pit intent and optional target compound requests.
- `scenarios.js` owns environment reset placement presets, absolute placements, and relative traffic layouts. It applies them through simulator state APIs during environment creation/reset only; it must not create policy-time teleport or assisted-control paths.
- `observations.js`, `sensors.js`, and `events.js` build sensor-style observations, versioned fixed-schema vectors, track lookahead/curvature, ray/nearby-car readings, and global/per-driver events.
- `recorder.js` owns neutral rollout transition export. It records environment-loop data and does not interpret rewards or policies.
- `evaluation.js` owns deterministic evaluation cases and metrics. It can run a supplied policy against fixed seeds/scenarios, but it must not update models or define reward objectives.
- `workerProtocol.js` owns the JSON-serializable wrapper used by external bridges. It forwards reset/step/spec/state messages to an environment instance and does not choose Python, Gymnasium, PettingZoo, or storage infrastructure.

The environment subpath must not import `src/index.js`, package CSS, PixiJS, `F1SimulatorApp`, or DOM-specific code.

`src/simulation/rulesConfig.js` owns ruleset normalization and modular race-rule defaults. It keeps old flat rule keys compatible while adding preset/module config for pit stops, tire strategy, penalties, and reserved future modules for weather, reliability, and fuel load. Race modules should be added there first, then consumed by simulation logic through the normalized `race.rules` object.

`src/simulation/trackModel.js` owns procedural track geometry, including start/finish normalization, sectors, DRS zones, and the deterministic pit-lane model. The model explicitly straightens the start/finish window so the starting grid, pit-entry approach area, and immediate post-line exit area are geometrically straight instead of merely choosing the least-curved generated segment. The pit lane is generated next to that start straight for every built track and exposes entry/exit connectors, explicit procedural road centerlines that overlap the track surface, connect on the lane-facing side of the main track, are tangent to the track at merge points and to the main pit lane at pit-lane endpoints, a straight main fast lane sized from the team/box run plus bounded entry/exit buffers, a parallel working lane, one shared service area per team, queue geometry behind each service area, and two garage boxes per team. The model also stores pit-lane world bounds so `nearestTrackState()` can skip pit road and service-box geometry checks for normal main-track points outside the pit area. `nearestTrackState()` classifies `pit-entry`, `pit-lane`, `pit-exit`, and `pit-box` as legal drivable states while preserving main-track `crossTrackError` for existing consumers. `src/rendering/proceduralTrackAsset.js` renders the same model with team-colored service areas, queue slots, and paired garage boxes, but draws main-circuit asphalt, kerbs, and borders above pit-lane asphalt so visual crossings are owned by the race track; it also renders an oversized grass background beyond the simulated world bounds, while the transparent race canvas host uses the same grass color as a fallback so deep zoom-out views do not expose host-page background. `F1SimulatorApp` overlays the dynamic pit-lane status light because open/closed/red-flag state belongs to race control, not the static track texture.

`src/simulation/rules/` owns focused rule calculation helpers. Each stewarded rule should have its own function and, once non-trivial, its own file. `raceSimulation.js` should orchestrate timing/state and call those helpers; rule modules should return events or penalty payloads rather than mutating the whole simulation directly.

`src/api/PaddockSimulatorController.js` owns composable mounting.

Responsibilities:

- Resolve host options once for component templates and runtime.
- Render each independently mounted component into its host root.
- Build a composite DOM query surface for `F1SimulatorApp`.
- Initialize and control the shared simulator runtime through `start()`, `restart()`, `destroy()`, and state methods.
- Expose explicit safety-car methods for callers that want to deploy or release the safety car without using package-rendered buttons.

## Runtime App

`src/app/F1SimulatorApp.js` owns browser runtime behavior.

Responsibilities:

- PixiJS application setup.
- Asset loading.
- Sprite creation.
- Control event binding.
- Fixed-step simulation pacing.
- Viewport/document visibility throttling for the PixiJS ticker.
- Camera modes.
- Overlay-safe camera framing for the left timing-tower preset.
- Timing tower rendering.
- Telemetry rendering.
- Race data panel rendering.
- Safety car button.
- Multiple package-rendered safety-car buttons bound to one simulation state.
- Restart behavior for race data, seed, and track changes. Asset URL changes and browser expert mode changes are intentionally outside restart because texture loading and ticker ownership are part of initialization.
- Lifecycle cleanup, including partial-init failure cleanup and destruction of replaced PixiJS display children without destroying shared textures.

When `options.expert.enabled` is true, `F1SimulatorApp` creates a narrow browser expert adapter around its existing `this.sim` race simulation. The adapter uses the same shared environment runtime as the headless API, but it must not create a second race simulation for the visual mount. Expert browser mounts disable automatic ticker-driven simulation advancement; the canvas updates only after `simulator.expert.reset()` or `simulator.expert.step(actions)` renders the new snapshot. The shared runtime owns controlled-driver pit intent defaults: controlled cars start with `pitIntent` set to `0`, tire-threshold automatic pit calls are disabled for them, and expert actions may request `0`, `1`, or `2` plus optional `pitCompound` through the simulation API instead of steering into the pit lane directly. Expert mode is a mount-time boundary; runtime restart rejects `expert` changes instead of attempting to rewire ticker ownership in place.

Expert sensor visualization belongs to the browser app layer, not the headless environment. The environment result owns the observation contract; `BrowserExpertAdapter` passes that observation into `F1SimulatorApp.renderExpertFrame()`, and `F1SimulatorApp` draws opt-in sensor rays in a Pixi world layer so they share the same camera transform as the track and cars.

This file is still large. When changing it substantially, prefer extracting cohesive modules rather than adding unrelated responsibilities.

`src/app/domBindings.js` owns DOM selector lookup and null-safe readout text writes for package-generated UI surfaces.

## Simulation Core

`src/simulation/raceSimulation.js` owns race state orchestration and the public `F1RaceSimulation` facade.

Responsibilities:

- Constructor wiring and shared state containers.
- Normalized ruleset/module state received from `rulesConfig.js`.
- Fixed-step execution order.
- Public facade methods used by hosts, tests, environment runtime, and browser runtime.
- Event buffer lifecycle.
- Delegation to feature-owned simulation modules.

`src/simulation/race/raceControlState.js` owns initial race-control and safety-car state construction.

`src/simulation/race/raceLifecycle.js` owns start-light updates, grid hold/release, and pit-lane open/closed transitions.

`src/simulation/race/safetyCar.js` owns safety-car and red-flag state transitions plus safety-car movement.

`src/simulation/race/redFlag.js` owns applying red-flag hold behavior to cars during the fixed-step loop.

`src/simulation/race/raceDistance.js` owns pure race-distance utilities including total-lap normalization, progress wrapping, lap calculation, and finish-distance calculation.

`src/simulation/race/raceOrder.js` owns ordered-car context, driver race context, aggression calculation, and DRS reference lookup.

`src/simulation/race/raceProgress.js` owns per-step race-state recalculation: progress, lap telemetry, sector timing, gaps, rank fields, attack state, and DRS latch coordination.

`src/simulation/race/raceFinish.js` owns finish detection and race-finish transitions while classification ranking remains in `classification.js`.

`src/simulation/race/classification.js` owns final classification ranking and classification consequences.

`src/simulation/pit/pitState.js` owns pit team assignment, pit-crew normalization, and pit-stop initialization.

`src/simulation/pit/pitIntent.js` owns manual and automatic pit-intent normalization and mutation.

`src/simulation/pit/pitFlow.js` owns pit-stop flow orchestration: scheduling, rearming, entry eligibility, stop start, queue/service/exit progression, and delegation to pit routing/service helpers.

`src/simulation/pit/pitRouting.js` owns pit-route construction, pit-lane route sampling, limiter-segment lookup, and render-pose shifts used by route/contact movement.

`src/simulation/pit/pitService.js` owns service-area occupancy, queue release, pit-service timing, pit-served penalties, tire changes, pit-exit release, and pit-route movement.

`src/simulation/pit/pitSnapshots.js` owns pit-lane status snapshots and public/render/observation pit-stop serializers.

`src/simulation/rules/rulesReview.js` owns dispatch from simulation state to steward modules, while individual steward modules continue to own penalty decisions.

`src/simulation/rules/penaltyStats.js` owns penalty-stat aggregation and lookup helpers.

`src/simulation/vehicle/contactResolution.js` owns physical collision resolution and contact velocity response. Stewarding remains separate from physical response.

`src/simulation/vehicle/runoffResponse.js` owns non-penalty off-track vehicle correction.

`src/simulation/snapshots/raceSnapshots.js` owns public, render, and observation snapshot assembly.

Weather effects, reliability failures, and fuel-load performance effects are not active 1.0 behavior. Their future ownership should stay separate from the race orchestrator: weather belongs in a future `src/simulation/weather/` module that returns track/session condition modifiers, reliability belongs in a future `src/simulation/reliability/` module that emits deterministic failure/degradation events, and fuel-load effects belong in a future vehicle-adjacent performance module that adjusts mass/pace through explicit inputs rather than hidden mutation.

`snapshot()` is the full public data contract and must remain stable for host callbacks, environment state, and external callers. Internal browser/rendering paths use lean read models such as `snapshotRender()` so the 60 FPS loop does not serialize setup, wheels, penalties, and other non-render fields every frame. Environment and sensor code may use similarly narrow internal views, cache shared per-observation ray origin state, and broadphase car-ray checks before exact footprint intersection, but those must not change the public `RaceSnapshot` shape.

`src/simulation/driverController.js` owns AI control decisions. It does not move cars directly; it samples the current track/race context, plans green-flag, rejoin, and safety-car targets, and returns steering/throttle/brake controls for `vehiclePhysics.js` to integrate. Green-flag steering combines target-point pursuit, capped upcoming-heading feed-forward, lateral correction, edge-pressure recovery, and a corner-apex offset so default cars can use the track width and carry speed through generated corners without bypassing steering-rate, grip, or yaw-rate limits. Its traffic planner keeps attack, defense, side-overlap, and lane-change thresholds in calibrated meter units so changing rendered scale or simulator-unit density does not silently weaken racecraft decisions. Safety-car queueing is also meter-calibrated: cars pursue compact frozen-order slots, add centerline correction, and cap corner speed so resized tracks do not create runaway safety-car gaps or off-track trains. Attack commitment and rejoin recovery are stored as deterministic per-car controller state; they affect only the next steering/throttle/brake request, not car pose or race order. The controller also treats braking and throttle as mutually exclusive during high steering or edge-recovery demand so it does not request power while trying to save a sharp corner.

`src/simulation/vehicleGeometry.js` owns deterministic car footprint math. It exposes the rendered-scale body hull, four wheel/contact-patch oriented rectangles, current/previous pose generation, AABB helpers, and a per-car `geometryState` cache keyed by current and previous pose. Collision detection, wheel-surface sampling, snapshots, and debug previews consume this module instead of each recreating car dimensions.

`src/simulation/collisionGeometry.js` owns shape-confirmed vehicle contact. It first prunes pairs by nearby track progress with a circular-track window, then uses swept body AABBs, SAT body/body overlap checks, and conservative continuous checks between previous and current poses. Wheel shapes are intentionally excluded from car-vs-car collision for cost and stability; wheel geometry is still used by the surface and track-limit pipeline. `raceSimulation.js` only orchestrates response/cooldown/steward review after this module returns contact metadata, and collision stewarding derives rear-contact fault from physical track order so lapped cars are handled consistently.

`src/simulation/wheelSurface.js` owns per-wheel track sampling and the effective car surface. On normal main-track running it uses the cached wheel geometry and the car center's track normal to analytically classify each wheel patch from signed offsets. Callers that already computed the center track state pass it in so wheel-surface classification does not repeat the same nearest-track scan. It falls back to full patch sampling near pit connectors and inside pit-lane states. It derives whether the full car is outside the white line and returns the worst wheel surface for physics. `vehiclePhysics.js` consumes that effective surface through the car track state, and separately compares left-side and right-side wheel resistance to add a small capped yaw bias toward the slower side. It does not classify surfaces from the car center.

`src/simulation/vehiclePhysics.js` owns vehicle integration using the already-resolved effective surface and wheel-state resistance imbalance.

`src/simulation/rules/pitLaneSpeedingSteward.js` owns pit-speed-limit review. `raceSimulation.js` calls it after authoritative race-state recalculation so it reads the same pit-lane part classification as snapshots and track-limit stewarding. The steward only checks speed-limited pit-lane parts (`fast-lane`, `working-lane`, service areas, and garage boxes), leaving pit-entry and pit-exit connector roads legal but not speed-limited.

`src/simulation/trackModel.js` owns track construction, procedural track generation, automatic three-sector metadata, DRS zones, and nearest-track queries. Browser mounts generate a fresh procedural seed when `trackSeed` is omitted; explicit procedural track seeds are cached so repeated mounts with the same seed do not regenerate or rebuild the same model. Procedural generation starts from package-owned spline-like templates with deterministic jitter, validates shape, clearance, local turn accumulation, and per-sample heading jumps, and falls back to another template-derived control set instead of an oval control ring when attempts fail.

`src/simulation/units.js` owns conversion between simulator units and public meter/km/h display values. Physics stays in simulator units; snapshots expose calibrated display fields such as `speedKph`, `distanceMeters`, and `gapMeters`.

`src/rendering/renderSnapshot.js` owns interpolation for rendering. It accepts either the full public snapshot or the lean render snapshot; render-only callers should prefer the lean snapshot.

The app runtime pauses its PixiJS ticker when the race canvas is outside the viewport or the document is hidden, then resets the frame clock before resuming. This prevents host pages with several simulator embeds from running every race while only one is visible, and avoids a large simulation catch-up step when the canvas re-enters view. Camera safe-area layout measurements are cached and invalidated by resize observation so the 60 FPS render path does not force repeated DOM geometry reads. Camera framing derives a cached active-track bounds box from generated samples plus pit-lane extent; overview uses that frame directly, and every camera uses it as the zoom-out floor. The first camera frame is applied immediately, then later camera mode changes interpolate target position and scale so leader/selected/overview/show-all/pit switches do not jump the world view. Runtime readouts avoid redundant DOM writes for unchanged text, timing markup, finish classification, and static selected-car overview data, and `updateDom()` reuses its supplied full snapshot for camera-control availability instead of taking another public snapshot. Static pit-lane status graphics are redrawn only when their status/geometry key changes, and DRS trail histories are pruned in place. Startup marks the initial DOM refresh time so the first ticker frame does not immediately redo the same full readout update. At `5x` and `10x` browser playback, noncritical DOM/timing refreshes are throttled more aggressively while fixed-step simulation, event emission, and rendering continue from authoritative simulation state. Long project-radio delays are also treated as stale schedule state instead of replaying every missed lower-third transition.

## Data Layer

`src/data/driverData.js` converts driver rating sheets into constructor arguments.

`src/data/vehicleData.js` converts vehicle rating sheets into physical setup values.

`src/data/championship.js` pairs drivers with entries and generates timing codes, numbers, team metadata, and converted constructor data. It rejects duplicate entry driver IDs, ignores omitted driver numbers during uniqueness checks, and falls back to stable grid-order numbers when host entries do not provide numbers.

`src/data/normalizeDrivers.js` validates host driver data, rejects duplicate driver IDs before runtime maps are created, and invokes championship pairing.

`src/data/demoDrivers.js` is demo/portfolio-flavored sample data. It should not become the only supported data path.

## UI Shell

`src/ui/componentTemplates.js` owns the generated markup and composition for non-banner UI surfaces:

- Race controls.
- Camera controls.
- Safety-car control.
- Timing tower.
- Race canvas.
- Telemetry stack template.
- Detached telemetry core, sector graph, lap-time table, and sector-time table.
- Race telemetry drawer template.
- Car/driver overview panel.

`src/ui/bannerTemplates.js` owns package banner markup:

- Top steward message for warnings and penalties.
- Shared race-data lower-third used by project and radio modes.
- Optional project telemetry detail inside the race-data lower-third.
- Standalone broadcast sector banner.

`src/ui/templateUtils.js` owns shared template helpers such as escaping and loading-state markup. Banner templates and non-banner component templates should share helpers through this module instead of importing from each other.

`src/ui/shellTemplate.js` composes those component templates into the default all-in-one simulator DOM and package-owned layout presets such as `left-tower-overlay`. Telemetry graph/table surfaces are independent package-owned components controlled by `ui.telemetryModules` when used through stack/drawer templates; the app renders them from `car.lapTelemetry` without requiring host-owned DOM. The telemetry stack can embed the car/driver overview, owns vertical scrolling when the host constrains its height, and is also embedded by the hide/show race telemetry drawer. The overview is also a separately mountable component. The project and radio lower-thirds share the same race-data panel markup; runtime state only swaps content and mode classes. The optional project telemetry detail lives inside that shared lower-third, while the broadcast sector banner remains a separate lower-third-style sector graph that can be mounted standalone or embedded inside the race canvas only when a host explicitly asks for that independent popup. `F1SimulatorApp` binds the selected car name/code/color to it through the same readout path as the other telemetry surfaces. The race telemetry drawer template composes an external top control row, race canvas with embedded timing tower, project/radio lower-third, top steward message, safety-car control, and the telemetry stack in a right drawer. Its open/close state is owned by `F1SimulatorApp`; the safety-car control, project/radio banner mute toggle, and telemetry toggle stay in the top row while telemetry is open. The drawer reserves final race-view space with a stable margin while the sidebar itself animates with a compositor transform, avoiding grid-template reflow during the slide. The drawer race area uses the configured workbench height so host embeds do not leave unused black space below the simulation. The left-tower overlay preset is responsible for internal component placement and package-owned proportions; the project/radio lower-third remains owned by the race canvas so it can either use the race space beside the timing tower in `auto` sizing mode or overlap the tower when space is constrained. Composable hosts can also ask the race-canvas template to embed the timing tower directly with `includeTimingTower`, using the same expand-vs-scroll vertical fit contract. `F1SimulatorApp` measures the resulting timing-tower gutter when framing the PixiJS camera, whether the tower comes from the prebuilt shell or from an embedded composable race canvas. It also owns camera mode availability, wheel/button zoom for every camera mode, temporary project/radio banner muting, hiding the pit camera control when the active track has no pit-lane geometry, and fitting the pit camera from operational `track.pitLane` lane, box, service, and queue bounds instead of host-provided coordinates or long access-road endpoints. On narrow hosts, CSS stacks timing boards full-width and the camera safe-area measurement treats those boards as stacked content instead of side gutters. Hosts should not provide the internal simulator markup or tune preset internals with raw sizing options.

Penalty UI is display-only. `F1SimulatorApp` may show track-limit warning events and `snapshot.penalties` in the top steward message, and may show timing-row penalty badges when the host enables those UI options, but the UI must not infer, modify, or recalculate steward decisions.

`src/config/defaultOptions.js` owns preset resolution, telemetry module normalization, and the public theme contract. Presets are merged before host options; theme fields are applied as package CSS variables by the all-in-one app and composable controller. This keeps sizing/color customization explicit without turning internal layout ratios into public API.

Race completion is owned by `src/simulation/raceSimulation.js`. The simulation records provisional `finishOrder` / `finishRank` as each car crosses the line and uses that order for snapshots until final classification exists, so app code never has to re-sort finished cars by live distance. The app layer reads `raceControl.finished`, `winner`, `classification`, and per-car `raceStatus` from snapshots, renders the timing/winner states, and emits lifecycle callbacks. Penalty lifecycle, pit-stop penalty service, service conversion, time adjustment, position drops, grid drops, and disqualification effects are applied inside the simulation, not in the UI. UI code may display countdowns from `pitStop.phase`, `serviceRemainingSeconds`, and `penaltyServiceRemainingSeconds`, but it must not infer, serve, or recalculate steward outcomes from lap text, timing rows, or car position.

Composable hosts may choose where each package-owned component root is placed, but they still receive package-generated markup through the public mount functions. The controller marks each mounted root as an `f1-sim-component` styling scope so standalone pieces receive the same package variables as the all-in-one shell.

`src/styles.css` styles the generated shell, imports package fonts, caps timing-tower width for readability, and owns the fixed-height timing-list scroll behavior. Timing rows are fixed grid rows stacked from the top, so rank positions do not stretch or redistribute when the number of entries changes. The timing tower owns its runtime interval-vs-leader-gap switch, while `F1SimulatorApp` reads both seconds and whole-lap gap values from the race snapshot and formats positive lap deficits as `+N` before seconds. Fixed hidden timing-line creation, crossing timestamps, and seconds-gap calculation stay inside `src/simulation/raceSimulation.js`. Sector-map surfaces read `lapTelemetry.sectorProgress` for bar fill and `lapTelemetry.liveSectors` for live active-sector time; the simulation owns those values so UI components do not infer active split state from DOM state. Future sectors are cleared by the simulation and ignored defensively by the renderer, so banner/sidebar sector nodes cannot keep stale timing text or yellow/purple/green performance classes after the active sector changes. Component templates include lightweight package-owned loading overlays; `F1SimulatorApp` removes them after startup initialization has completed.

The host page should only provide:

```html
<div id="f1-simulator-root"></div>
```

## Assets

`src/config/defaultAssets.js` imports bundled assets from `assets/` and exposes default asset resolution.

Assets are bundled by the host build tool when the package is imported.

## Tests

Tests live in `src/__tests__/`.

Current coverage includes:

- Championship metadata.
- Component API and callback behavior.
- Driver controller behavior.
- Expert environment actions, observations, rewards, events, and browser adapter behavior.
- Procedural track rendering helpers.
- Race simulation rules.
- Render interpolation.
- Track model behavior.

Run:

```bash
npm test
```

## Design Rule

Keep reusable simulator behavior in PaddockJS. Keep website-specific data and routing in the host.

If a change adds portfolio-only behavior to package internals, move it to the host integration layer instead.
