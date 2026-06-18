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

CSS-free data/helper import:

```js
import {
  DriverData,
  normalizeSimulatorDrivers,
  createProceduralTrack,
} from '@inventure71/paddockjs/data';
```

The environment subpath is the only public headless training import. The data subpath is for host tooling and browser/server build code that needs data helpers without importing package CSS. Both subpaths must stay free of DOM, PixiJS, CSS, and browser app dependencies.

Root package exports:

| Export group | Public exports | Use |
| --- | --- | --- |
| Browser mounts | `mountF1Simulator`, `createPaddockSimulator` | all-in-one shell or composable package-owned UI surfaces |
| Composable helper mounts | `mountRaceControls`, `mountCameraControls`, `mountSafetyCarControl`, `mountTimingTower`, `mountRaceCanvas`, `mountTelemetryPanel`, `mountTelemetryCore`, `mountTelemetrySectors`, `mountTelemetrySectorBanner`, `mountTelemetryLapTimes`, `mountTelemetrySectorTimes`, `mountRaceTelemetryDrawer`, `mountCarDriverOverview`, `mountRaceDataPanel` | function-call wrappers around a composable simulator controller |
| Startup placeholder | `createPaddockLoadingPlaceholder` from `@inventure71/paddockjs/placeholder`, plus `@inventure71/paddockjs/placeholder.css` | optional pre-JS loading placeholder that does not import PixiJS, simulator assets, root runtime CSS, or the browser mount |
| Data helpers | `DriverData`, `VehicleData`, `CHAMPIONSHIP_ENTRY_BLUEPRINTS`, `DEMO_PROJECT_DRIVERS`, `buildChampionshipDriverGrid`, `formatDriverNumber`, `normalizeSimulatorDrivers` | demo data, host entry normalization, and rating helper construction |
| Theme helpers | `DEFAULT_PADDOCK_THEME`, `PADDOCK_THEME_CSS_VARIABLES`, `PADDOCK_THEME_TOKEN_KEYS`, `resolvePaddockTheme`, `applyPaddockTheme` | host-side theme preview/sync code without copying package token names |
| Package constants | `DEFAULT_F1_SIMULATOR_ASSETS`, `PADDOCK_SIMULATOR_PRESETS` | inspect bundled asset mapping and UI preset defaults |
| Track and units | `createProceduralTrack`, `REAL_F1_CAR_LENGTH_METERS`, `VISUAL_CAR_LENGTH_METERS`, `SIM_UNITS_PER_METER`, `TARGET_F1_TOP_SPEED_KPH`, `metersToSimUnits`, `simUnitsToMeters`, `kphToSimSpeed`, `simSpeedToKph`, `simSpeedToMetersPerSecond` | generated track definitions and physical/display unit conversion |
| Controller loop | `createPaddockDriverControllerLoop` | compatibility browser export for shared model-controller orchestration; browser-free code should import it from `@inventure71/paddockjs/environment` |

Data subpath exports:

| Export | Use |
| --- | --- |
| `DriverData`, `VehicleData`, `CHAMPIONSHIP_ENTRY_BLUEPRINTS`, `DEMO_PROJECT_DRIVERS`, `buildChampionshipDriverGrid`, `formatDriverNumber`, `normalizeSimulatorDrivers` | CSS-free host data normalization and rating helper construction |
| `createProceduralTrack` | CSS-free procedural track generation helper |
| `kphToSimSpeed`, `simSpeedToKph` | CSS-free speed conversion helpers |

Placeholder subpath exports:

| Export | Use |
| --- | --- |
| `createPaddockLoadingPlaceholder(options)` | Generate inert, escaped startup placeholder HTML for the network/import gap before the root simulator bundle runs. |
| `PaddockLoadingPlaceholderOptions`, `PaddockLoadingPlaceholderVariant` | TypeScript shapes for host placeholder configuration. |

Environment subpath exports:

| Export | Use |
| --- | --- |
| `createPaddockEnvironment` | browser-free step/reset runtime for JavaScript training and evaluation loops |
| `createPaddockDriverControllerLoop` | shared controller-loop helper for browser expert mode or headless environments |
| `createProgressReward` | optional demo reward used by examples; not the package objective |
| `createRolloutRecorder`, `createRolloutTransition` | neutral rollout transition recording helpers |
| `DEFAULT_EVALUATION_CASES`, `createEvaluationTracker`, `runEnvironmentEvaluation` | deterministic evaluation cases and metric aggregation |
| `ENVIRONMENT_SCENARIO_PRESETS` | reset-only scenario placement presets |
| `createEnvironmentWorkerProtocol`, `handleEnvironmentMessage` | JSON-serializable worker bridge helpers |

`createProgressReward()` is published from the same subpath only as non-canonical demo reward code for examples and smoke tests. It must remain optional and replaceable; environment stepping must continue to work with a custom `reward(context)` callback or no reward callback. Reward callbacks are user-owned formulas over package-owned facts, including neutral per-driver `metrics` and `info.drivers[driverId]` episode state. They run only for `step(actions)` transition results; reset/read paths are reward-neutral. Non-finite or missing callback results are normalized to a neutral `0` reward for that controlled driver.
Ray observations expose track-transition distance and car distance per ray. Track transitions use `kind: 'exit'` when the ray starts on track and reaches the border, `kind: 'entry'` when the ray starts off track and reaches the road again, and `kind: null` with max distance when no transition is visible. Driver-precision road-edge, kerb, and illegal-surface channels use direct indexed ray-band intersections when the candidate boundary can be validated against driver track state, including validated off-track recovery boundaries. Barrier-origin recovery rays also stay on the direct indexed path when the tracer can already prove road-edge/kerb misses and the first non-barrier illegal-surface entry. Direct ray-band intersection consumes query-index segment IDs and typed centerline arrays instead of materializing temporary segment objects; the object-returning segment query helper remains for public/debug callers. Scratch-backed internal ray batches reuse the rich ray channel containers for road-edge, kerb, illegal-surface, and car hits, and car-hit footprint checks reuse the caller-owned ray vector plus a per-ray result target instead of recomputing ray geometry; no-scratch public ray calls still return fresh channel objects. Batch-training surface-only ray batches synthesize safe main-road origin state from same-pose `progress`/`signedOffset` geometry and reuse shared track-band boundary plus surface-hit containers, so kerb/illegal-surface channels stay indexed without nearest-track origin classification or per-ray hit-object replacement. Ambiguous recovery, pit-connector, and pit-lane-origin rays that are still not provable from the indexed bands are resolved by one bounded sampled recovery pass inside the ray-band tracer so all requested road/surface channels share the same sampled states. Debug precision uses the same tracer-owned path with additional sampled refinement for diagnostic distances; only missing-index cases use the older sampled fallback path. Track-position, surface, pit-lane, and ray fallback queries use an internal non-enumerable track query index built with the track model. Pit-road state classification reuses indexed route candidate buckets, one polyline projection result, and precomputed cumulative route distance tables for entry, fast-lane, working-lane, and exit roads. Connector-adjacent direct pit-entry/pit-exit override checks reuse that same projection target and route metadata; endpoint-progress shortcuts use precomputed endpoint segment windows, and mid-connector points use bounded indexed route candidates without becoming full pit-lane queries. The runtime track-query benchmark explicitly requires those pit-road probes to stay indexed with reused direct connector scratch, positive endpoint-window connector projections, zero connector full-route projection scans, reused route scratch, precomputed distances, zero cumulative-distance rebuilds, and zero pit fallbacks. Browser/expert mounts, headless environments, direct race-simulation construction, and compact training-style environment runs all use the indexed path. This changes runtime cost, not public observation shapes.

Scratch-backed internal ray batches also keep requested-channel dispatch in reusable scalar channel flags owned by the shared ray query. The runtime benchmark contract fails if the common direct sensor-ray path allocates channel `Set` containers or replaces those channel-flag containers between batches.
The package must not own model training, model persistence, model registries, or trained policy behavior. The supported contract is: external code reads observations, returns normalized actions, and advances either the headless environment or browser expert mode.
The shared expert runtime exposes `getActionSpec()` and `getObservationSpec()` so external code can inspect controlled drivers, action ranges, sensor layout, nearby-car limits, track lookahead fields, and the versioned vector schema before connecting a model. Environment reset may apply deterministic scenario placement presets or explicit placement/traffic layouts; model steps may not mutate position and still use normalized actions only. Neutral rollout recording, deterministic evaluation metrics, and the JSON worker protocol are environment utilities, not training algorithms.
`createPaddockDriverControllerLoop({ runtime, controller, actionRepeat })` is the shared public controller orchestrator for browser playback and JavaScript training-style loops. `runtime` may be browser expert mode or a headless environment, and `controller.decideBatch(context)` is called once per policy step for all controlled drivers in stable spec order. The loop lazily resets when scheduled playback starts from a fresh instance, caches `actionSpec` and `observationSpec`, reuses the active observation payload, supports async controllers, forwards actions through the normal `step(actions)` API, and repeats each decision for `actionRepeat` runtime frames. Scheduled playback stops and records `stats.lastError` when controller initialization, decision, stepping, or `onStep` hooks fail. `stop()` cancels pending package-owned scheduler handles and custom scheduler handles that either expose `cancel()` or return browser-style numeric timeout/animation-frame ids. It does not load checkpoints, run neural networks, parse model formats, compute rewards, or mutate vehicle state.

All-in-one mount call:

```js
const simulator = await mountF1Simulator(root, {
  drivers,
  entries,
  onDriverOpen,
  seed,
  trackSeed,
  trackGeneration,
  warmup,
  totalLaps,
  physicsMode,
  rules,
  participantInteractions,
  replayGhosts,
  initialCameraMode,
  preset,
  title,
  kicker,
  backLinkHref,
  backLinkLabel,
  showBackLink,
  ui,
  theme,
  debug,
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

The all-in-one shell normalizes `backLinkHref` before rendering it. Package-owned race controls accept relative URLs, hash URLs, and absolute `http:` / `https:` URLs; unsafe or malformed values fall back to the default `projects.html` link instead of being rendered into the anchor. Runtime readouts also validate snapshot-derived color values before writing CSS custom properties, and package-owned asset URLs are escaped before becoming CSS `url(...)` values.

Composable mount call:

```js
const simulator = createPaddockSimulator({
  drivers,
  entries,
  onDriverOpen,
  seed,
  trackSeed,
  trackGeneration,
  warmup,
  totalLaps,
  physicsMode,
  initialCameraMode,
  participantInteractions,
  replayGhosts,
  rules: {
    ruleset: 'custom',
    modules: {
      pitStops: { enabled: true },
      stalledDnf: { enabled: true },
      tireStrategy: { enabled: true, mandatoryDistinctDryCompounds: 2 },
    },
  },
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

Pit APIs are rule-gated. `setPitIntent()` returns `false` until the active rules enable `rules.modules.pitStops.enabled` and the active track has pit-lane geometry. `tireStrategy` does not enable automatic pit routing by itself; it only controls available compounds, tire requirement stewarding, and pit target choices.

The controller methods above are the canonical composable API. They keep component mounting, lifecycle, restart, theme syncing, and runtime state on one controller object. Standalone helper functions are also exported as thin wrappers for host code that already uses function-call style:

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
  mountCarDriverOverview(root),
  mountRaceDataPanel(root),
  querySelector(selector),
  querySelectorAll(selector),
  start(),

  // Included on both APIs:
  destroy(),
  restart(nextOptions),
  setTheme(theme),
  setThemeMode(mode),
  getTheme(),
  syncThemeFrom(element, { attribute, map }),
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
- Mount component roots before calling `start()`. A pre-start `restart(nextOptions)` re-resolves options and refreshes already mounted component markup, so non-asset changes such as title, kicker, UI visibility, theme, drivers, entries, seed, or track seed are reflected before `start()` binds the runtime.
- `mountF1Simulator()` and each composable `mount*()` call must synchronously write lightweight package HTML before awaiting runtime initialization. Those startup templates may contain controls/readout placeholders, but they must not require PixiJS, texture loading, race stepping, or host-provided hidden DOM to be visible.
- Timing tower, telemetry, controls, and race-data panels are optional from a runtime safety perspective; omitted panels simply do not render their readouts.
- Timing tower entries are compact content-sized rows stacked from the top of the timing list. Row vertical position must be based on rank/index, never distributed by available height or total entry count. `ui.timingEntryVerticalPadding` defaults to `5` and applies that pixel value above and below every row entry.
- Timing tower entries display team icons. `ui.timingGapMode` sets the initial display to interval-to-car-ahead timing or direct gap-to-leader timing, and the controller can change it at runtime with `setTimingGapMode()`, `getTimingGapMode()`, or `toggleTimingGapMode()`. The tower shows one compact `Int`/`Gap` header toggle by default. That toggle must stay aligned with the other timing header labels, preserve a practical `44px` target, draw active/focus treatment inside the timing header rather than outside the column, and never change the timing board width. `ui.timingGapModeToggle: false` hides only the manual header affordance; it must not disable the controller API. Seconds gaps are calculated from hidden timing-line crossings, and whole-lap deficits display as `+N`.
- Snapshots expose calibrated display units through `speedKph`, `distanceMeters`, and `gapMeters`; internal physics remains in simulator units. Public timer, lap-time, sector-time, gap-time, penalty-time, and service-countdown values are seconds.
- Snapshots expose automatic three-sector track metadata through `track.sectors` and per-car lap/sector timing through `car.lapTelemetry`, including completed current-lap sector splits before the active sector, live active-sector elapsed time, per-sector progress, and sector performance classes for overall-best, personal-best, and slower completed sector times. Future-sector timing/progress entries are cleared so banner and sidebar telemetry cannot display stale split values from another lap or state.
- Entries can include optional `team` metadata. Team color defaults to car color when omitted.
- Mounted package surfaces show a package-owned red start-light loading overlay until `start()` finishes PixiJS, asset, control, initial readout, and first-frame initialization. `F1SimulatorApp.completeComponentLoading()` marks the owning `data-paddock-component` as loaded and removes `data-paddock-loading` nodes after the initial frame is rendered.
- Package loading overlays are a post-JavaScript client startup state, not a server-rendered skeleton. Before the root PaddockJS bundle has downloaded, parsed, and called a mount function, only pre-existing HTML/CSS can paint. The optional `@inventure71/paddockjs/placeholder` subpath and `@inventure71/paddockjs/placeholder.css` stylesheet are the package-owned phase-1 contract for that gap. They must stay independent of PixiJS, simulator assets, root package CSS, app runtime modules, and browser mount side effects.
- `preset` is a preset-first API. Presets are resolved before explicit host overrides so hosts can use `dashboard`, `timing-overlay`, `compact-race`, or `full-dashboard` as a starting point and still override specific `ui` or `theme` fields.
- `theme` is the public sizing/color contract. It resolves semantic package-owned tokens into complete light/dark themes, supports named derivative theme packages through `theme.themes`, selects the active package with `theme.use`, applies component-specific packages through `theme.componentThemes`, and accepts team selectors through `theme.teamThemes` or `entries[*].team.theme`. Component theme keys accept package component ids such as `timing-tower` and camelCase aliases such as `timingTower`; `selectedDriverPanel` targets both selected-driver package surfaces. Selected-driver surfaces use the selected team's theme by default when one is available while structural controls keep the active global theme unless explicitly overridden. Unknown theme tokens or component slots are ignored, one-sided light/dark token overrides generate and cache the opposite mode, and theme plus driver/team colors are validated before they are written to CSS variables. Legacy aliases such as `accentColor`, `greenColor`, and `yellowColor` remain migration aliases for the new semantic tokens.
- `setTheme(theme)`, `setThemeMode(mode)`, and `syncThemeFrom(element, options)` are runtime presentation APIs. They must resolve through the same theme normalizer used at mount time, reapply CSS variables to every package-owned mounted root, and must not call `restart()` or replace race state. Existing simulation state, timing order, selected driver, active penalties, camera state, speed setting, and pit intent state remain owned by the running app. `syncThemeFrom()` applies immediately, watches the configured attribute with `MutationObserver` when available, maps host attribute values through `options.map`, and returns a cleanup function.
- `initialCameraMode` accepts `'overview'`, `'leader'`, `'selected'`, `'driver'`, `'show-all'`, or `'pit'`; invalid values fall back to `'leader'`. The overview camera frames the active generated track bounds with package-owned padding and pit-lane extent. The driver camera follows the selected car from a lower screen anchor and rotates the world so the selected car points upward; its control is opt-in through `ui.driverCamera: true`, and `initialCameraMode: 'driver'` enables that control automatically. The pit camera frames the operational `track.pitLane` lane, boxes, service areas, and queue areas instead of the longer entry/exit access roads, zooms out when needed to keep that pit-lane work area inside the active race-view safe area, and its control is hidden/disabled if the active track has no pit lane. Zoom buttons and wheel zoom work in every camera mode, including overview, show-all, driver, and pit, but cannot zoom farther out than the active track frame.
- Camera controls default to external placement so they do not cover the race view. They can still be embedded in the race canvas by setting `ui.cameraControls: 'embedded'`, externally mounted, or omitted with `false`. Generated camera controls include a `Mute banners` toggle that is off by default and temporarily suppresses project/radio lower-thirds while active. The driver camera button is omitted unless `ui.driverCamera` is active.
- Telemetry surfaces are detached package components: core scalar readouts, sector graph, broadcast sector banner, lap-time table, and sector-time table. The broadcast sector banner shows the selected car identity, uses the selected car color for its frame/label, and keeps sector performance colors inside the sector bars. It is an explicitly mounted independent surface, not the default telemetry-drawer lower-third. `mountTelemetryPanel()` is the stack template around those detached pieces, owns vertical scrolling when constrained, and `ui.telemetryModules` controls which pieces appear in stack/drawer templates.
- `mountRaceTelemetryDrawer()` creates a package-owned race workbench: external top controls, race canvas, embedded timing tower, lower-third banner, top steward message, safety-car control, and a right-side telemetry drawer. The top row holds camera controls, banner mute, safety car, and telemetry toggle outside the canvas. On narrow responsive containers, that toolbar stacks into readable full-width rows and keeps safety car plus telemetry as a two-column action row instead of squeezing them beside the camera controls. Pass `{ raceDataTelemetryDetail: true }` when the drawer lower-third should include compact project telemetry detail. The drawer opens smoothly, takes width from the race view instead of overlaying it, is inert/hidden to interaction when closed, and embeds the same `telemetry-stack` component used by standalone telemetry panels.
- The FPS readout can be shown or hidden with `ui.showFps`.
- `ui.layoutPreset: 'left-tower-overlay'` is a package-owned preset that creates a left broadcast gutter inside the race view, places the timing tower there at the same width as the default timing-board column, frames the PixiJS camera around the remaining usable race area, and keeps camera controls and start lights out of the tower area. In the combined shell, project and radio lower-thirds stay inside the race window while being allowed to cover the timing sidebar.
- `ui.raceDataBanners.initial` controls the starting lower-third (`'project'`, `'radio'`, or `'hidden'`), and `ui.raceDataBanners.enabled` controls which lower-third types can appear. The runtime banner mute state temporarily disables project/radio lower-thirds without changing these configured allow-lists.
- Project and radio lower-third pills include a package-owned top-right close button that dismisses the current pill early. The next pill appears only through normal driver selection or radio scheduling.
- When a composable host mounts more than one package-owned race-data panel, such as an embedded race-canvas lower-third plus `mountRaceDataPanel()`, the panels share the same runtime project/radio/hide state and each panel's open/dismiss controls remain wired.
- `ui.raceDataBannerSize` controls lower-third sizing: `'custom'` keeps the default CSS-variable-driven banner size for host tuning, while `'auto'` uses the race space to the right of the timing board when wide enough and overlaps the timing board only when space is constrained.
- `ui.raceDataTelemetryDetail` adds compact S1/S2/S3 sector detail to the project lower-third while keeping radio mode unchanged.
- `ui.timingTowerVerticalFit` controls vertical tower behavior in the combined overlay preset: `'expand-race-view'` grows the race window to fit the tower, while `'scroll'` crops the tower area and scrolls timing rows inside it. The same values are accepted as `mountRaceCanvas()` options when `includeTimingTower` embeds the tower in the race canvas.
- `ui.timingGapMode` controls whether the timing tower starts in `'interval'` or `'leader'` mode. `ui.timingGapModeToggle` defaults to `true`; setting it to `false` hides the manual header toggle while preserving runtime control through the mounted simulator/controller methods. Hosts that need a different control placement should hide the package toggle and call those methods from host-owned UI instead of restyling package internals.
- Hosts may scale the whole mounted simulator through the container. The horizontal proportions inside package-owned presets are not public API and should not be configurable through raw width or ratio options. The supported inline-size envelope starts at `320px` for the package-owned mount root or individual composable surface. Hosts should provide responsive outer containers with `min-width: 0` and avoid targeting package internals; PaddockJS owns timing-board width, camera safe-area math, lower-third containment, drawer sizing, and internal density tiers. The camera reads the current canvas dimensions so wider or taller host windows reveal more of the race view without needing host-owned camera math, and the renderer keeps grass coverage beyond the simulated world so deep zoom-out does not show host background. The timing tower has a package-owned max width because overly wide timing boards degrade readability; standalone hosts can constrain vertical height through the mount container and let the timing entries scroll internally. Mobile and narrow embeds are handled by package CSS plus a package-owned resize observer: embedded timing towers become left reveal panels when they no longer work as side gutters, camera controls stay in external control rows when mounted, narrow telemetry drawers reveal over the race view instead of forcing permanent canvas shrinkage, and closed reveal panels stay inert/hidden while the renderer and camera resize continuously without simulator remounts. A narrow lower-third may cover empty timing-tower chrome, but if the measured lower-third would cover any timing entry, PaddockJS adds measured lower-third clearance to the race view's minimum height; when timing entries remain clear, the height remains governed by the timing tower/race-view minimum. Template responsive narrow variants are enabled by default through `ui.responsiveNarrowLayout`; hosts can set `ui.responsiveNarrowLayout: false`, or pass `responsiveNarrowLayout: false` to composable race-canvas/drawer mounts, to opt out.
- Package layout density tiers are container-owned: `320px`-`519px` is mobile density, `520px`-`759px` is narrow tablet density, `760px`-`1119px` is tablet density, and `1120px` and wider is desktop density. Component behavior follows the actual package container width, not only the browser viewport, so embedded timing towers and composable pieces remain safe inside split tablet layouts.
- If the shell/mount root is narrower than `320px`, or if an individual package component is constrained below its component-specific inline/block minimum, the component sets `data-paddock-size-unsupported="true"` and displays a package-owned accessible unsupported-size placeholder instead of broken UI. The broadcast timing tower is one intentional exception to a blanket `320px` subcomponent rule: it remains valid at its package-owned narrow timing-board width. The placeholder uses `role="status"` and `aria-live="polite"`. Hosts should fix the outer container size rather than hiding package content or patching package internals.
- Package controls, drawer toggles, lower-third actions, and dismiss buttons maintain practical `44px` touch targets, shared visible focus states, and `touch-action: manipulation`. Timing rows are compact selectable broadcast entries controlled by `ui.timingEntryVerticalPadding`. Touch driving or virtual joystick controls are intentionally out of scope.
- The host does not need to provide simulator assets.
- The host passes data, not internal DOM.
- Host driver IDs and entry `driverId` values must be unique. Entries may omit `driverNumber`; provided numbers must be unique.
- `totalLaps` is normalized to a finite positive integer before simulation so invalid input cannot produce zero-lap, negative-lap, or non-finite snapshots.
- `physicsMode` accepts `'arcade'` and `'advanced'`. The default is `'arcade'` to preserve existing hosts. `'advanced'` is opt-in and keeps cars controlled only through steering, throttle, brake, and pit intent while enabling traction-budget limits, steering scrub, velocity-heading slip, surface-specific grip/drag, and advanced telemetry. The old `'simulator'` mode name is removed and falls back to `'arcade'` like any other invalid value. Snapshots expose `physicsMode` plus per-car `lateralG`, `longitudinalG`, `gripUsage`, `slipAngleRadians`, `tractionLimited`, `stabilityState`, and the latest `appliedControls`.
- `restart(nextOptions)` can change race data and deterministic seeds such as `trackSeed`, but it does not support changing asset URLs. Asset changes require `destroy()` and a fresh mount because PixiJS texture loading is an initialization boundary.
- `onDriverOpen(driver)` is the navigation boundary.
- Lifecycle callbacks are optional: `onLoadingChange`, `onReady`, `onError`, `onDriverSelect`, `onRaceEvent`, `onLapChange`, and `onRaceFinish`. Lifecycle callback failures are routed to `onError` when possible and must not stop the simulator loop. `onDriverOpen(driver)` is host-owned navigation code and is not wrapped as a lifecycle callback.
- Race completion is part of the simulation snapshot. Cars receive individual `finished`, `finishTime`, `finishRank`, `status: 'waved-flag'`, `raceStatus: 'waved-flag'`, `wavedFlag`, `penaltySeconds`, `adjustedFinishTime`, and `classifiedRank` values as they cross the finish distance. Destroyed/out-of-race cars expose `dnf`, `dnfReason`, `dnfAt`, and `dnfOrder`, appear below active cars in timing, render faded/gray in the race canvas, and do not block race completion while they remain DNF. The first finisher sets a provisional `raceControl.winner`; already-finished cars remain frozen in provisional finish order while the remaining cars complete the distance. Final `raceControl.classification` and `raceControl.finished` are set only after every race participant has finished or is DNF. DNF entries are included after finishers with no finish time. A DNF car restored before final classification re-enters live timing and must finish; after final classification, resurrection does not reopen the race. Final classification converts unserved drive-through and stop-go penalties into configured time, sorts finishers by `finishTime + penaltySeconds`, applies position-drop and disqualification consequences, then race control switches to `safety-car`, the final order freezes to the classified result, and the field keeps circulating under safety-car behavior.
- Race rules support package presets and custom module config. Supported rulesets are `paddock`, `grandPrix2025`, `fia2025`, and `custom`. Active advanced modules include pit stops, tire strategy, tire degradation, stalled off-track DNF, and penalties. Weather, reliability, and fuel load are reserved module placeholders only; they do not currently change grip, power, retirement risk, mass, or pace. The current simulator normalizes all module config, creates/renders track-owned pit-lane geometry on tracks whose resolved generation options enable it, treats pit-lane asphalt, working-lane service areas, and garage boxes as legal drivable surfaces, runs automatic bounded pit-train entry/service/exit through the main fast lane and shared team service areas when pit stops are enabled, lets host/expert pit calls choose a target tire compound, uses the team queue point as a rolling gate when the service area is free, queues a second team car behind the active service area and moves it forward through a queue-release route only after the active service area is physically clear, keeps pit-route approach speed bounded until the final queue/service capture instead of crawling through open route, optionally varies pit-service time from team pit-crew stats with a perfect-training override, supports pit-lane open/closed state plus red flags, requests pit stops from configurable tire-energy thresholds, applies nonlinear tire-grip degradation down to 1% unless `rules.modules.tireDegradation.enabled` is `false`, can retire cars that remain off legal racing/pit surfaces below the configured stalled-DNF speed threshold for the configured duration when `rules.modules.stalledDnf.enabled` is `true`, applies the pit speed limiter only on the main pit lane/working lane, enforces pit-lane speeding on speed-limited pit-lane parts but not on entry/exit connectors, keeps the safety car about `55m` ahead of the leader with compact `22m` frozen-order queue slots, lets the built-in driver AI ride kerbs, attack, defend, and recover through normal steering/throttle/brake decisions with short controller-state commitments for rejoin and attack decisions, and enforces stewarded penalties for collisions, track limits, pit-lane speeding, and tire requirements. `tireStrategy` does not enable automatic pit stops; `pitStops.enabled` is required for pit routing and non-clear pit intent requests.
- Penalty subsections use `strictness` from `0` to `1`, not only boolean enablement. `strictness: 0` means the subsection is not enforced; `strictness: 1` applies the configured rule margin. Steward decisions are exposed as `penalty` events and as top-level `snapshot.penalties`. Penalty entries include normalized consequences and lifecycle status. Immediate consequences apply time, grid, position, or disqualification effects directly; drive-through and stop-go consequences remain issued until served, cancelled, or converted at final classification.
- The browser UI can opt into top steward messages with `ui.penaltyBanners` and timing-row penalty badges with `ui.timingPenaltyBadges`. Steward messages render track-limit warning events and penalty decisions from the simulation; time-penalty messages put the penalty seconds in a large left chip and use penalty-colored backgrounds, while warnings use warning-colored backgrounds. Timing-row `!` badges are rendered only from `snapshot.penalties`; warning events do not count. UI code must not recalculate steward decisions.
- The simulator must stay interactive after being installed through `npm install @inventure71/paddockjs`.
- The package must build correctly through a browser bundler that supports JavaScript modules, CSS imports, and image imports.
- Package CSS must be scoped to package mount roots/components and must not style same-named host elements outside `.f1-sim-component` roots. Generic simulator classes such as `.sim-control`, `.camera-controls`, `.timing-list`, `.telemetry-header`, and `.start-lights` are package internals, not host styling hooks. The stylesheet uses system font stacks by default and must not force remote font requests; hosts that want custom typography should load those fonts themselves and pass theme/CSS-variable overrides.
- The simulation should remain deterministic for the same seed, track seed, drivers, entries, and rules.
- Warmup is enabled by default for browser mounts, headless environments, and direct simulation creation. It runs on a disposable runtime and must not mutate the visible initial race state; under the default `warmup.policy: 'config-change'`, identical configuration fingerprints reuse cached warmup while seed/config changes rerun warmup automatically.
- When `trackSeed` is omitted in a browser mount, the simulator creates a fresh procedural circuit for that mount. Explicit `trackSeed` values are deterministic and cached by seed plus resolved generation options for repeated mounts. Cached procedural definitions are immutable; callers that import `createProceduralTrack(seed, options)` should treat the returned definition as read-only and clone it before custom mutation. `trackGeneration` forwards the same procedural options used by `createProceduralTrack(seed, options)`: `profile`, `length`, `startStraight`, `pitLane`, `shape`, `validation`, and `attempts`. The `race` profile preserves the default full circuit with pit lane; `training-short`, `training-medium`, and `training-technical` are smaller pitless presets intended for training or demos. Explicit option fields override profile defaults after the profile is resolved. Procedural generation traces seeded connected region boundaries, smooths and warps them into centerline controls, then rejects circuits with excessive local heading jumps, turn accumulation, self-intersections, poor clearance, invalid length, or weak shape variation.
- The renderer should target a paced 60 FPS simulation/render loop.
- The render loop should pause while the race canvas is offscreen or the document is hidden, then resume without catching up the elapsed hidden time. Runtime visibility must not rely on a single observer state: it should resync from canvas geometry after observer, scroll, resize, focus, and page-show signals, and ticker sync should reconcile the intended runtime state with PixiJS' actual started/stopped state. Layout measurements needed for overlay camera safe areas should be cached between resize/layout invalidations. Runtime DOM updates should skip unchanged text/markup so visible embeds do not rewrite stable readouts every frame.
- Restart and rerender paths must destroy replaced PixiJS display children while preserving shared loaded textures.
- Restart supports race/data/seed changes but does not support asset URL changes or browser expert mode changes. Texture loading and ticker ownership are mount-time boundaries; hosts must destroy and mount again to change either boundary.
- Expert environment code can create a headless `createPaddockEnvironment()` from the `@inventure71/paddockjs/environment` subpath. It requires explicit `controlledDrivers`, accepts normalized actions `{ steering, throttle, brake }` plus optional `pitIntent` and `pitCompound`, advances only through `step(actions)`, and returns environment-loop JavaScript results with `observation`, `reward`, `metrics`, `terminated`, `truncated`, `done`, `events`, `state`, and `info`. `steering` is an absolute normalized steering target: `-1` points at maximum left, `0` points at center, `1` points at maximum right, and intermediate values are percentages of the maximum steering angle; the vehicle integrator rate-limits motion toward that target instead of snapping the wheel. `steering`, `throttle`, and `brake` are required for each controlled-driver action. Strict action policy throws on missing or non-finite vehicle controls, while report policy records the error and releases stale manual controls so the built-in driver owns that physics step. `info.drivers[driverId]` exposes per-driver `terminated`, `truncated`, `endReason`, `episodeStep`, and `episodeId` for batched loops; selected-driver resets clear only selected driver truncation/termination and do not rewind global `info.step`. For scoped reset results, `info.controlledDrivers` matches the drivers present in `observation` and `metrics`, while `info.drivers` preserves episode state for all configured controlled drivers. Controlled drivers do not receive tire-threshold automatic pit calls; they request automatic pit service through `pitIntent`, may choose the target tire through `pitCompound`, and observe pit-lane/service/race-control state in `observation[driverId].object.self` and `.race`. `pitIntent: 0` is a no-op clear request and does not fail when pit stops are disabled. `self.onTrack` follows wheel-level legality, so track, kerb, and legal pit-lane/box surfaces are on-track while gravel/grass/barrier are off-track. Barrier-wall contact in both physics modes is measured against the rendered wall's inner face; contact marks the car destroyed/DNF, removes it from active collision/sensor participation, emits a `car-destroyed` event, and terminates that driver's episode with `endReason: 'destroyed'`. Opt-in stalled off-track DNF removes the car from the same active participation systems while keeping `destroyed: false` and terminates controlled-driver episodes with `endReason: 'stalled-off-track'` when `rules.modules.stalledDnf.enabled` is `true`. Reset is still an episode-boundary `resetDrivers()` call. Environment scenarios may set reset positions with `preset`, `placements`, and relative `traffic`; `resetDrivers(placements)` may reset selected controlled drivers between episodes without recreating the whole simulation. Partial `reset(options)` calls preserve omitted nested option groups while replacing arrays and explicit scenario placement maps. After placement, selected cars are classified by the same runoff/barrier rules before observations are returned, so cars already inside terminal barrier space report destroyed metrics and stable miss-valued rays instead of doing alive-car far-out ray scans. Both scenario placement and `resetDrivers()` are setup data, not policy actions. `participantInteractions` may make real physics cars non-colliding, sensor-hidden, non-blocking for pit occupancy, or excluded from race order, but those cars still live in `snapshot.cars` and move only through normal physics/control APIs. The `batch-training` profile is non-colliding, sensor-hidden, pit-non-blocking, excluded from race order, and still rendered. `replayGhosts` are separate trajectory-driven entities in `snapshot.replayGhosts`; they are visual/reference overlays and never enter car physics, timing, pit, order, or penalty systems. Replay ghosts are sensor-hidden unless their own sensor flags explicitly opt them into ray or nearby observations.
- Headless environments also accept an optional `externalRenderer` observer hook. It receives `{ snapshot, observation, meta }` on `reset`, `step`, and `resetDrivers`, so external tooling can stream authoritative frames to visualizers without letting that transport mutate simulation state.
- Controller loop code should use `createPaddockDriverControllerLoop()` instead of duplicating browser/headless stepping. Its controller context groups observations by controlled driver id, includes `orderedObservations` for direct batch tensor assembly, exposes metrics, events, cached specs, and reset-driver ids, and keeps per-driver resets as controller reset hooks when the runtime supports `resetDrivers()`. `previousActions` is the last action map actually applied before the current `actions`; on the first controlled frame after reset it is empty, and after repeated frames it reflects the prior physics step rather than pre-copying the current decision.
- Expert ray sensors originate from the controlled car center. The default compact set is `[-135, -60, -20, 0, 20, 60, 135, 180]`, giving forward, side, and rear awareness while staying small. Rays detect track edges against the actual track geometry and detect car hits by ray-to-car-footprint intersection; scratch-backed car-hit checks use the same caller-owned ray vector as the road/surface tracer and scalar local footprint math. Hosts may opt into per-ray lengths, predefined layouts such as `driver-front-heavy`, and surface-aware channels for kerb and illegal surface detection; those channels are computed only when requested. `precision: 'driver'` road-edge, kerb, and illegal-surface channels use validated direct indexed ray-band intersections for safe normal-driver main-track geometry and validated off-track recovery boundaries; the `batch-training` profile keeps the accelerated direct indexed contract for safe main-track rays, including surface-only batches that reuse shared surface-hit and track-band boundary scratch. Ambiguous recovery, pit-connector, and pit-lane-origin rays use bounded sampled validation inside the ray-band tracer, and `precision: 'debug'` uses that same tracer path with extra sampled refinement for diagnostics. Only missing-index cases use the older sampled fallback path. This preserves model-facing distances without substituting debug-only refinement. Barrier walls are rendered/physical terminal boundaries, not model-facing ray targets; active ray objects, vectors, schemas, and visualizations must not expose a `barrier` ray channel. Ray `precision` defaults to `driver`, which is the active model-facing sensor contract; `debug` precision is only for explicitly labeled diagnostics. `observation.profile: 'physical-driver'` exposes local driver-like yaw, contact-patch, boundary, richer ray, and opponent-radar senses while omitting default lookahead samples unless explicitly configured. `observation.output` can be `full`, `vector`, or `object`, `includeSchema: false` omits repeated schema payloads, and `vectorType: 'float32'` returns typed vector buffers for high-throughput JavaScript loops. `result.stateOutput` can be `full`, `minimal`, or `none`; `none` returns `state: null` and is intended for loops that rely on observations, metrics, and info instead of full snapshots.
- Scratch-backed expert ray batches dispatch those requested channels through reusable scalar flags on the shared ray query. This is an internal runtime contract only; public ray objects still expose the same road-edge, kerb, illegal-surface, and car channel objects.
- Track surface bands are single-source geometry. Rendering derives visible gravel, runoff, and barrier offsets from the same track widths used by wheel surfaces and ray surface hits: road edge, kerb outer edge, gravel outer edge, runoff outer edge, and barrier wall width. New code must not add independent magic offsets for these bands.
- Browser expert mode is opt-in with `expert: { enabled: true, controlledDrivers, frameSkip }`. It shares the environment episode lifecycle. The default episode horizon is a high safety cap (`1_000_000` expert steps, roughly 4.6 hours at 60Hz with `frameSkip: 1`) so normal browser sessions should end by race finish instead of max-step truncation. Bounded training, evaluation, and smoke loops should pass an explicit smaller `episode.maxSteps`; `episode.endOnRaceFinish` controls whether race finish is terminal. When enabled, the returned controller exposes `expert.reset()`, `expert.step(actions)`, `expert.getObservation()`, and `expert.getState()`.
- Browser expert mode also exposes `attachExternalRenderer(source)`, `detachExternalRenderer()`, and `getExternalRendererState()` for render-only external-frame playback. The `source` callback contract is `subscribe(onFrame) => unsubscribe`, where each frame is `{ snapshot, observation, meta? }`.
- Browser expert mode wraps the same `RaceSimulation` instance that the visual canvas renders. It must not create a parallel simulation for the same mount.
- Browser expert mode disables automatic ticker-driven simulation advancement. The visual canvas updates only after explicit expert `reset()` or `step(actions)` calls.
- While external renderer mode is attached, browser expert runtime is strict render-only and rejects local `step()`, `resetDrivers()`, and `reset()`. Hosts must detach before returning to local stepping; detach restores the current local simulation track surface if external frames had redrawn the shared track asset.
- Policy Runner `Live preview stream` mode accepts `ws://`/`wss://` push streams and `http://`/`https://` polling endpoints that return `preview:snapshot` frames.
- Policy Runner `Policy server` mode uses compact HTTP protocol version `2`. Reset/init requests include static specs, configuration, `previousActionFields`, and `metricFields`; per-decision `/policy/decide-batch` requests include `driverIds` plus aligned compact `vectors`, `previousActions`, `metrics`, and `events` arrays only. There is no rich per-decision compatibility toggle in the local-preview policy-server controller; server integrations must read vector inputs by matching `driverIds[index]` to `vectors[index]` and cache the tuple field order received on reset. Full public snapshots remain available through explicit host/debug/export/state APIs, not as the policy-server transport default.
- Browser expert mode may opt into `expert.visualizeSensors: true` or `expert.visualizeSensors: { rays: true }`. When enabled, ray sensors render in the race canvas world layer from the selected controlled car by default, using the same observation result produced by explicit expert steps. The overlay draws a separate colored marker for each detected active channel on each ray, including road-edge, kerb, illegal surface, and car hits. Barrier walls are visible track geometry, not ray-hit markers, and browser components must not reintroduce a barrier ray label. Hosts may request `visualizeSensors: { rays: true, drivers: 'all' }` for the heavier all-controlled-car overlay or pass an explicit driver id list. Every model-facing sense follows this rule: the model receives the active environment observation, and Policy Runner/expert visualization displays that same observation instead of recomputing a more precise or different browser-only value. Extra diagnostics must be clearly separated from model senses.

## Current Visible Features

- Timing tower with position, team icon, timing code, interval/gap switch, and tire compound.
- Race canvas rendered with PixiJS.
- Procedural track rendering with asphalt texture and DRS overlays.
- Driver selection from cars and timing tower rows.
- Camera modes: overview, leader, selected, driver, show all, and pit.
  Overview frames the active generated track bounds with package-owned padding and pit-lane extent; driver rotates around the selected car for user-driving views; show all dynamically fits the active pack; pit frames the operational pit-lane work area when the track has one.
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

Full public race snapshots include `car.trackState` as the serialized car-center track classification. The stable fields are `distance`, `signedOffset`, `crossTrackError`, `surface`, `inPitLane`, `pitLanePart`, `pitBoxId`, `curvature`, and `heading`; pit-specific fields are `null` when not active. In-memory `snapshot.track` remains the live runtime geometry object, but JSON serialization of that track uses a cached rounded public view, exports decimated `track.samples` rows through `track.sampleSchema`, and omits engine-only pit query helpers such as `pitLane.bounds`, `pitLane.boxBounds`, `pitLane.connectorBounds`, pit-crew metadata, and duplicated pit-box/service-area team fields so full-state export/stream paths do not stringify internal geometry helpers or redundant static pit metadata. Runtime readouts normalize missing optional snapshot arrays and race-control groups before rendering, so partial startup or external-renderer frames do not break the package-owned UI.

## Runtime Requirements

- Browser environment with DOM APIs.
- A host build tool that handles CSS and image imports. Vite is the currently verified bundler.
- `pixi.js` available through the package dependency graph.

Raw Node imports of the package root are not a supported runtime check because the browser component entry imports CSS and image assets. The `@inventure71/paddockjs/environment` subpath is the supported browser-free import path for headless JavaScript training.
The package exposes a JSON-serializable worker protocol wrapper so external processes can bridge to the JavaScript environment without PaddockJS choosing Python, Gymnasium, PettingZoo, model storage, training algorithms, checkpoint formats, or training infrastructure.

## Verification

Run from this package:

```bash
npm run check
```

Expected:

- Fast Vitest tests pass in the normal local gate. Slow characterization tests run under `npm run check:release`.
- `npm pack --dry-run` succeeds and includes source files plus bundled assets.
- A packed tarball installs and builds inside a fresh temporary Vite consumer app.
- Packed subpath bundle-boundary checks verify that the root import remains the CSS/asset-owning browser simulator bundle while `/placeholder`, `/data`, and `/environment` stay CSS-free or lightweight according to their documented roles.
- The tracked showcase host builds.
- The quick Chromium browser smoke verifies showcase canvas rendering, overflow constraints, one public API action, and live customization theme switching. The release browser smoke verifies the desktop/mobile matrix, package-panel overflow constraints, customization route interactions, public API buttons, and visual policy-runner stepping across generation and race configurations.

Use [Testing Reliability Guide](testing-reliability-guide.md) to choose the smallest behavior-focused proof for a change before relying on the broad package gate. The guide is authoritative for mapping package/API, simulation, environment, browser, performance, and docs changes to focused tests and required broader verification.

For internal runtime-efficiency development only, also run:

```bash
npm run benchmark:runtime -- --profile=standard --verify --json
```

Expected:

- The benchmark suite includes simulation stepping, render snapshot creation, timing DOM updates, compact policy-server JSON, and full snapshot JSON characterization.
- Full snapshot JSON characterization now enforces compact serialized track geometry, including a capped per-snapshot track JSON size after decimating exported track samples, because `snapshot.track` is the dominant static export cost.
- Compact policy-server transport remains materially smaller and cheaper to stringify than full observation/snapshot payloads; regressions should be treated as performance contract failures unless the API intentionally changes.
- This is a contributor regression tool, not a host-consumer or release-note requirement.

Run from a browser host that consumes the published package:

```bash
npm install @inventure71/paddockjs@latest
npm run check
```

Expected:

- The host bundle builds with PaddockJS resolved from npm.
- Browser smoke shows shell, canvas, driver rows, FPS readout, and working `Open project` navigation.
