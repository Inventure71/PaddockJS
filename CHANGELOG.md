# Changelog

## 4.2.0

### Minor Changes

- Tighten the package boundary around supported simulator, environment, display, data, and Python policy-server example surfaces. Local JavaScript training experiments now live outside the published package surface, and release-facing docs no longer advertise the removed local starter trainer as packaged guidance.
- Keep browser expert resets aligned with the resolved `physicsMode` and harden unsupported physics-mode handling so documented hosts continue to use only `arcade` or `advanced`.
- Add stricter CLI validation for release and diagnostic scripts. Browser smoke, consumer smoke, bundle-boundary checks, runtime benchmarks, track-query benchmarks, and hotspot profiling now provide clean help output and reject unknown or conflicting arguments before running expensive work.
- Clean up showcase/package-boundary examples so rendered snippets import only public package symbols and leave preview-local policy adapters as host-owned code.

### Performance And Runtime

- Reduce hot-loop allocations in built-in driver control by reusing racing-line profiles, traffic scan entries, lookahead sample objects, and target-point scratch while preserving the same steering/throttle/brake action contract.
- Add allocation-light track sampling helpers and a prepared sample-index lookup table so repeated `pointAt`/heading/curvature queries avoid binary-search and temporary-object churn on the common simulation paths.
- Reuse vehicle geometry, body AABB, swept AABB, and interpolated body-shape containers across collision and render paths instead of rebuilding geometry wrappers and axis objects every step.
- Reuse participant-interaction serialization for render snapshots and avoid repeated spread/object reconstruction in participant interaction resolution.
- Reduce per-step race/rules/timing churn by replacing transient race-order maps, steward review spreads, repeated inactive-steward state objects, and sector serialization maps with pooled or direct loop paths.
- Keep advanced/simulator-mode checks behind one helper so browser expert resets, red-flag release, collision damping, driver stabilization, and external state placement stay aligned with the documented `physicsMode` contract.

### Fixes And Hardening

- Preserve the resolved advanced physics mode when the browser expert adapter resets its environment, so expert-controlled browser runs do not silently fall back to arcade behavior.
- Keep unsupported browser and headless `physicsMode` values normalized to `arcade`, including explicit regression coverage for both surfaces.
- Carry optional `driverModel` metadata from driver or vehicle input into runtime car state for host-owned model/controller bookkeeping without adding a package-owned model loader.
- Tighten the environment performance characterization threshold for vector/object observation runs so ray-enabled physical-driver observations remain under the fixed local timing budget.

### Showcase And Tooling

- Add a playable-preview physics selector so the keyboard workbench can switch between arcade and advanced physics through the same documented query-parameter path as the rest of the preview.
- Add the `scripts/profile-hotspots.mjs` local profiling helper for advanced-mode race hot spots, with validated `--steps`, `--help`, and extra-argument handling.
- Split browser-smoke and runtime-benchmark argument parsing into focused helpers with direct unit coverage, and extend script coverage across consumer smoke, bundle-boundary, track-query benchmark, and profiler entrypoints.
- Keep the packed release contents focused on published package assets, docs, Python policy-server examples, source modules, public styles, and placeholder assets.

### Migration Notes

- No breaking host migration is required from `4.1.0`.
- Supported browser mounts, composable mounts, `@inventure71/paddockjs/environment`, `@inventure71/paddockjs/data`, and `@inventure71/paddockjs/placeholder` keep their documented public import contracts.
- Hosts should not depend on removed repository-local JavaScript training scripts or preview-only policy helper names. Use the documented environment API, custom model controller guide, or Python policy-server bridge for external training and policy integration.

### Verification Notes

- The final release gate is `npm run check:release`.

## 4.1.0

### Minor Changes

- Add a tiny pre-JS startup placeholder subpath and stylesheet for hosts that want an instant simulator loading surface before importing the full PaddockJS browser runtime. Also tighten the built-in component loading overlay contract across public mounted surfaces.

## 4.0.0

### Major Changes

- Make Policy Runner HTTP server mode compact by default through protocol version `2`. `/policy/reset` receives static specs and configuration once, while each `/policy/decide-batch` request sends compact vectors, previous actions, metrics, and events instead of repeating rich observation objects, schemas, snapshots, or track metadata.

### Performance And Runtime

- Rework the race-step phase order so normal active steps perform one authoritative broad race-state commit per simulation step, while pre-physics work reads the previous committed state.
- Make the normal active-step broad commit consume the already-refreshed post-motion wheel/track state instead of recomputing wheel-surface classification a second time for every car.
- Derive broad-commit DRS reference cars from one physical-track-order pass instead of re-scanning the full field for every car during the same commit.
- Keep the common no-DNF full-field DRS reference build on the already-ordered race field and write references straight into the reused indexed buffer, so the benchmark broad-commit path avoids rebuilding a second live-car list before the same ordered-forward reference walk.
- Keep DRS latch updates on cached active-zone references and in-place detection records instead of repeatedly re-finding the same zone by id and rebuilding the detection object shape on every broad-commit latch update.
- Cache the next DRS detection-zone index on each car across steady forward motion, so broad-commit DRS latch updates stop rescanning the whole DRS-zone list on the common path while external car-state jumps still invalidate the cache safely.
- Add a narrower cached-next-zone no-crossing fast path inside broad-commit DRS latch updates, and enforce it with direct unit coverage plus runtime benchmark counters so the dominant steady-forward unlatched case stays off the generic wrap-aware crossing math.
- Keep the broad-commit DRS latch path on a sim-bound scalar call instead of rebuilding the same options object for every car on every step.
- Keep the common no-finish race-end check on one direct ordered-field pass, so broad commits stop allocating a temporary finished-car list and then rescanning the same field again just to prove the race is still running.
- Reuse lap-telemetry sector arrays and sector-performance buffers in place during broad race-state commits, removing per-step short-lived timing allocations without changing the public telemetry shape.
- Keep lap-telemetry position refresh in place during broad commits, so normal per-car telemetry updates stop allocating a temporary lap/sector position object before rewriting the same fields back onto `lapTelemetry`.
- Keep the common no-boundary lap-telemetry path on a narrower in-progress sync that updates only live scalars plus the active-sector slots, instead of re-synchronizing the whole three-sector position structure on every committed step.
- Dirty-gate broad-commit sector-performance classification so unchanged current/last/best sector buffers keep their existing `lapTelemetry.sectorPerformance` arrays instead of rebuilding the whole field classification on every committed step.
- Reduce browser/runtime churn by keeping full public snapshots for host/debug/export/full-state APIs while using lean render, training, and transport paths for hot loops.
- Keep Policy Runner diagnostic JSON throttled so automatic playback does not stringify the debug readout every frame.
- Keep more driver-precision road-edge, kerb, and illegal-surface rays on the direct indexed ray-band path, including validated off-track recovery boundaries, and resolve ambiguous recovery, pit-connector, and pit-lane-origin rays through one bounded sampled pass inside the ray-band tracer instead of separate road/surface fallback scans.
- Keep diagnostic `debug` precision inside the same ray-band tracer, including refined sampled recovery for pit-connector and other ambiguous diagnostic rays, so debug ray builds no longer escape to the legacy separate road/surface scans unless the track index is unavailable.
- Keep common main-road illegal-surface direct rays on tracer-owned post-kerb band classification instead of re-running generic nearest-track validation at the outer kerb boundary, so validated direct sensor-ray paths cut their remaining classification queries without reopening the sampled-recovery cases.
- Rebuild direct sensor-ray origin state from same-pose main-road `progress`/`signedOffset` geometry when that pose already matches the live ray origin, so the runtime sensor-ray benchmark stays on its direct boundary-validation work instead of paying an extra nearest-track origin lookup on every iteration.
- Let batch-training surface rays use the same ray-band tracer as normal driver rays, with a main-track-only connector mode and scratch-owned tracer result/surface-boundary containers, so kerb/illegal-surface-only batches stay on reusable direct indexed geometry with `nearestQueries: 0` and no per-ray tracer result replacement.
- Anchor direct sensor-ray boundary validation on the exact ray-hit boundary segment neighborhood instead of a generic nearest-track classification lookup, so the benchmark direct path keeps all `320` rays fully direct with `nearestQueries: 0` while generated-track validation still agrees with sampled characterization.
- Reuse the already-known main-road origin classification on direct sensor-ray boundary validation, so main-road direct rays validate the outside boundary sample only and the benchmark direct path drops from two indexed boundary-neighborhood queries per ray to one without reopening sampled recovery or generic nearest-track fallbacks.
- Keep barrier-origin direct illegal-surface boundary validation on the exact ray-hit segment neighborhood instead of falling back to generic nearest-track classification for those three boundary samples, and pin that path with a dedicated runtime benchmark that must stay fully direct with `nearestQueries: 0` and `segmentNeighborhoodQueries: rayCount * 3`.
- Keep barrier-origin off-track recovery rays on direct indexed band classification whenever the tracer already proves road-edge/kerb misses and the first non-barrier illegal-surface entry, so that recovery route no longer drops into the sampled local-marching path just to confirm the same result.
- Keep direct sensor-ray boundary tracing on reusable segment-id scans and centerline typed arrays instead of materializing temporary track segment objects, and pin zero ray segment object allocations in the runtime benchmark contract.
- Keep indexed sensor-ray boundary tracing on tracer-owned reusable offset, distance, segment-id, and boundary-result containers in the per-ray scratch query, and enforce that direct sensor rays reuse those containers in the runtime benchmark contract.
- Keep indexed sensor-ray grid traversal on one query-scratch sample point instead of allocating a temporary `{ x, y }` point per ray-grid step, and enforce that sample-point reuse in the runtime benchmark contract.
- Keep sensor-ray channel selection on reusable scalar channel flags in the per-ray shared query instead of allocating `Set` containers or using filter/spread min helpers on the hot tracer path, and enforce zero channel-set allocations plus stable channel-flag containers in the runtime benchmark contract.
- Resolve pit-lane-origin side rays directly from the pit-road normal/width geometry when the current pit-lane frame proves the boundary hit, so common pit transition rays avoid sampled nearest-track classification entirely while retaining bounded sampled recovery for ambiguous pit rays.
- Keep pit-route transitions on route-owned scalar segment cursors, reusable stop sample points, and reusable route-projection scratch instead of allocating sampled route points or projection objects during entry, queue-release, and exit movement, and add a required runtime benchmark category that fails on sample allocations or cursor fallback scans.
- Keep indexed pit-road state projection on reusable polyline projection plus index-owned route distance tables instead of rebuilding candidate sets, filtered segment arrays, or cumulative distance arrays for each entry/fast-lane/working-lane/exit classification, and extend the track-query benchmark with explicit pit-road probes that require grid hits, scratch reuse, precomputed route distances, zero cumulative-distance rebuilds, zero grid misses, and zero pit fallbacks.
- Keep scratch-backed rich sensor rays on stable road-edge, kerb, illegal-surface, and car-hit channel containers across repeated direct builds, while public no-scratch ray calls still receive fresh channel objects.
- Keep car-ray exact footprint checks on the caller-owned ray vector and scalar local footprint math, writing scratch-backed hits into reusable per-ray result targets and pinning zero car-ray vector recomputes in the sensor-ray runtime benchmark.
- Reuse scratch-backed ray-detectable target arrays and target wrappers across vector-only environment ray batches, so car-ray broadphase stops rebuilding target metadata containers while public no-scratch sensor calls keep fresh target arrays.
- Keep scratch-backed per-car ray target filtering on one stable filtered-target container and scalar write/count loops, so the car-ray path stops rebuilding callback-driven target lists before each ray batch and the runtime benchmark now fails if that filtered container is replaced.
- Cache normalized ray options inside scratch-backed ray batches and scalarize ray-option normalization loops, so repeated raw ray option objects no longer rebuild normalized ray/channel arrays before every rich/vector/append sensor pass.
- Reuse headless environment observation lookup scratch for controlled-driver car maps and no-event grouping, so vector-only training steps stop rebuilding those lookup containers on every result while public observation shapes stay unchanged.
- Reuse headless environment metric lookup scratch for previous/current car maps and contact-event driver grouping, so vector-only training steps stop rebuilding those metric containers on every result while contact counts still dedupe duplicate driver ids per event.
- Precompute the nearest nonlocal segment distance for each track segment through the kerb band and let hinted nearest-track queries trust local segment neighborhoods only when the current offset is geometrically provable, so centerline/near-center common paths avoid extra exact-grid refinement while close-loop and generated-track cases stay on the more defensive indexed path.
- Precompute ring-1 segment-neighborhood density per track-query cell and let low-density `track/kerb` hinted nearest-track queries trust their exact local segment neighborhood even when the nonlocal distance proof stays inconclusive, so the benchmark nearest-track path keeps the benchmark track on local geometry instead of dropping into exact-grid refinement while denser generated-track cells stay on the defensive path.
- Precompute exact ring-1 candidate segment neighborhoods for low-density query cells and let hinted gravel-adjacent nearest-track queries prove exactness by ring-2 lower bounds before falling into the full exact-grid walk, so the benchmark nearest-track path keeps most remaining gravel queries off the broader cell-search loop while denser or more ambiguous cells still fall back to the original exact refinement.
- Route low-density cell exact nearest-track queries through that grid-owned ring-2 proof before any arc-bucket prepass, so the benchmark gravel path no longer computes the radius-2 arc candidate window just to hand off to the same certified cell-neighborhood winner.
- Route outside-runoff nearest-track queries through the sparse exact segment-grid walk before arc buckets, so far-out recovery and destroyed-car classifications use the grid-owned exact proof directly instead of seeding the same exact result through a radius-2 arc candidate prepass.
- Keep benchmark-style runoff nearest-track queries on an exact radius-2 segment-neighborhood proof guarded by ring-3 cell lower bounds, and seed the fallback exact-grid walk from that same local winner when the proof does not close, so the remaining hinted runoff path avoids repeating inner-cell work while generated-track equivalence stays covered.
- Start exact-grid nearest-track refinement at the first occupied segment-grid ring instead of rescanning known-empty inner rings, so far-off accurate-hint queries skip empty-cell work before they reach real track geometry while preserving the same exact winner.
- Skip recomputing the already-seeded hinted winner segment when exact-grid nearest-track refinement starts from an initial local projection, so hinted off-track exact checks spend less time re-evaluating the same segment before scanning genuinely competing cells.
- Precompute the common radius-2 arc-bucket segment neighborhoods at track-query index build time and reuse those candidate lists on hinted arc lookups, so the dominant remaining arc-hint nearest-query path stops rebuilding and re-deduping the same five-bucket candidate window on every query.
- Precompute immutable centerline projection scalars per segment and reuse them across exact-grid, arc-bucket, candidate, and neighborhood track-query loops, so hot nearest-track projection paths stop rebuilding the same `dx`/`dy`/length-span math on every segment visit.
- Cache repeated progress-hint segment resolution and hint-point reconstruction across adjacent same-distance nearest-track queries, so the indexed hinted path stops repeating the same binary-search and hint-point reconstruction work for each offset around the same centerline sample.
- Replace the blanket pit-connector wheel-surface fallback with per-wheel connector geometry plus tighter exact local segment-neighborhood wheel-center projections for the real connector cases, batch those exact wheel-center neighborhood queries across all four wheels, skip pit-lane override work when main-track precedence already settles the wheel, and skip pit-box grid scans outside service/garage bounds, so the benchmark connector pose keeps its one-nearest-query-per-iteration shape, no longer wastes pit-box misses, and connector wheel-center queries stop rebuilding the broader default neighborhood separately for each wheel.
- Route direct `calculateWheelSurfaceState()` calls through the same scalar wheel-state writers used by the scratch-backed apply path, removing the public-path `map()`/patch-sample fallback arrays and adding a wheel-surface benchmark gate for scratchless scalar writer batches and per-wheel writes.
- Make exact local segment-neighborhood batch queries scan the shared neighborhood once for all requested wheel centers instead of rerunning the same exact neighborhood walk per wheel, so connector local-refresh path queries reuse segment data without changing exactness.
- Skip pit-lane override index work for nearest-track queries already proven to be on the main road and outside pit-box bounds, so connector-adjacent common-path track classification stays on the geometry result instead of paying unnecessary pit road/box candidate scans.
- Keep connector-adjacent pit-entry/pit-exit nearest-track classification on indexed endpoint-window road candidates keyed by track-progress hints, so the track-query benchmark no longer drops those valid cap projections onto the full pit-road polyline fallback after a road-grid miss.
- Resolve connector-adjacent pit-entry/pit-exit overrides and adjacent non-pit gravel/runoff skips directly from exact local pit-road geometry before the indexed pit-lane query path, so the benchmark track-query route keeps the remaining connector cases off pit-road grid work entirely while preserving the same pit-lane classification.
- Keep those direct connector pit-road projections on the query-index-owned reusable projection target and route-distance metadata, and extend the runtime track-query benchmark so direct connector state/skip coverage must also prove projection scratch reuse.
- Precompute pit-route endpoint segment windows and use bounded direct connector projection candidates instead of scanning full pit-entry/pit-exit polylines in connector shortcut paths, while mid-connector points without endpoint progress hints use indexed route candidates without counting as full pit-lane queries.
- Keep hinted nearest-track projections on a direct hinted-segment neighborhood through the main-road, kerb, and gravel bands, and resolve the remaining wide-runoff cases through one wider same-neighborhood segment-radius search instead of spending the extra local segment-grid refinement on the benchmark path.
- Precompute the wrapped segment-id neighborhoods for the dominant radius-2 and wide-runoff hinted nearest-track searches, so those hot local hinted paths stop rebuilding the same wrapped modulo walk on every query.
- Keep hinted and exact local segment-neighborhood track projections on direct wrapped segment loops instead of materializing temporary neighborhood id arrays first, and pin zero hinted-neighborhood id scratch materialization in the runtime benchmark contract.
- Keep nearest-track exact-grid, arc-bucket, and candidate scans on scalar candidate accumulation instead of allocating transient per-segment projection objects during the hot indexed query path, and pin zero candidate projection object allocations in the runtime benchmark contract.
- Reuse one internal nearest-track projection scratch object through `nearestTrackState()` while keeping the public nearest-track projection query fresh per call, and pin that reuse in the runtime benchmark contract so the hot indexed track-state path stops rebuilding the same transient projection container.
- Keep connector local-refresh wheel-surface handling on exact wheel-center projections alone when every exact wheel center still resolves to the main track, so that route avoids materializing redundant finalized connector queried track-state pools before falling straight back to analytic wheel-state handling.
- Keep the explicit-center connector local-refresh path on a one-pass analytic summary whenever the exact batched wheel-center neighborhood queries all stay on the main track, and add a dedicated runtime benchmark for that explicit-center route so post-runoff wheel-surface work is measured against the same path the sim actually uses during local refresh.
- Refresh automatic connector-adjacent wheel-surface center state through the existing local runoff-track fast path instead of a broad nearest-track query when a previous committed track state already exists, and pin zero nearest queries for the near-pit connector benchmark path in the runtime benchmark contract.
- Reuse the already-committed current-pose `car.trackState` directly on same-pose automatic connector-adjacent wheel-surface refreshes, so the near-pit connector benchmark no longer spends a fifth local segment-neighborhood query just to re-derive the already-valid center state.
- Prove straight connector-adjacent main-track wheel footprints analytically from the center track frame before running exact wheel-center neighborhood projections, so centered pit-straight connector local-refresh paths stay on reusable analytic wheel writes with `segmentNeighborhoodQueries: 0` and `segmentNeighborhoodBatchCalls: 0` while ambiguous pit-side wheels still use the exact connector geometry path.
- Thread the already-resolved current vehicle geometry straight through wheel-surface recomputes and delay connector sample-closure creation until the path actually needs sampled recovery, so common local-refresh wheel-surface work stops paying duplicate current-geometry reads and unused connector closures.
- Add a strict common-case wheel-surface fast path for cars whose center state is still on the main track and not near a pit connector, so the dominant local-refresh path returns directly from the analytic main-track branch instead of walking the pit/connector decision tree before landing on the same result.
- Make exact local segment-neighborhood projections write their final result into reusable target objects instead of allocating a fresh projection object for every connector/runoff exact query, and enforce that reuse on the connector wheel-surface benchmarks.
- Keep the exact connector wheel-center batch path allocation-light by reusing the queried-state target array and reusable wheel-center point refs instead of allocating a fresh batched state array and copying the results back out on every local-surface refresh.
- Skip connector wheel-center track queries entirely for connector-adjacent main-track cars whose full wheel footprint stays on the opposite half of the track from the pit-lane side, keeping those cars on the plain analytic wheel path and cutting the local-surface connector query volume back to the ambiguous cases only.
- Replace per-step timing-history `shift()` trimming and timing-line key rescans with bounded lazy compaction and cached timing-line retention bounds, and add a warmed-history runtime benchmark so long-run timing maintenance stays production-ready.
- Skip unchanged zero-travel timing-line maintenance once the retained-line prune cutoff is already current, so idle broad-commit timing updates stop rescanning stored crossing keys while still preserving the first prune/bounds catch-up pass.
- Move runtime timing-history writes onto a fixed structured ring store, so broad race-state commits stop allocating a fresh `{ time, raceDistance }` object for every car on every timing sample while keeping legacy array readers valid for tests and older internal fixtures.
- Cache the last successful structured timing-history interpolation neighborhood and probe it first on the next adjacent-gap lookup, so broad-commit interval timing stops rescanning the same timing-history window from the tail on every repeated follower-gap estimate.
- Bound timing-gap timing-line scans to the overlapping stored line window shared by the compared cars, so broad race-state commits stop walking the full retained timing-line span when the latest shared crossing already proves the interval gap.
- Skip timing-line gap scans entirely when either compared car has not stored a valid timing-line window yet, and enforce that empty-window fast path with a runtime benchmark that must perform zero timing-line crossing reads.
- Skip the timing-line helper call entirely on the common empty-window gap-estimation path, so adjacent broad-commit gap checks fall straight back to timing-history interpolation without paying extra timing-line wrapper/setup work when no stored timing-line window exists.
- Cache the last successful timing-history interpolation segment as direct distance/time scalars, so the common adjacent broad-commit gap path can reuse the same structured timing-history segment on nearby repeated targets instead of rebuilding the segment lookup from the offset cache every call.
- Flatten Policy Runner protocol `2` per-decision JSON around `driverIds`, sending aligned vector arrays, compact previous-action tuples, and compact metric tuples while moving tuple field order into reset metadata, so HTTP policy-server mode spends less bandwidth and stringify time without reintroducing rich observation payloads.
- Keep `car.trackState` and the wheel-surface cache wrapper stable across internal `applyWheelSurfaceState()` recomputes, so the exact post-physics local-refresh path stops replacing those hot-loop containers when only the track-state fields changed.
- Replace per-call wheel-surface cache signature string building with direct geometry-pose and center-state field checks, so repeated explicit-center refreshes stay on the cache-hit path without avoidable string churn.
- Split current-pose vehicle geometry reuse from swept-collision geometry reuse so pre-physics wheel-surface refreshes do not rebuild the same current wheel/body geometry just because `previousX`, `previousY`, and `previousHeading` were updated for collision history.
- Update the cached current-pose vehicle geometry state in place when the car's live pose changes, so post-physics wheel-surface refreshes stop allocating a fresh current body/wheel/corner tree for every moved car on every step.
- Keep the cached current-pose geometry writer on shared heading scalars and direct body/wheel rectangle writes, so post-motion local refresh no longer allocates temporary axis and center objects while rebuilding the stable geometry tree.
- Keep current-pose wheel/body corners lazy inside the wheel-surface geometry cache, so normal post-motion refresh only rebuilds contact-patch centers, axes, and extents while sampled recovery paths still materialize and reuse exact corners on demand.
- Drop unused string signature bookkeeping from the hot current-only vehicle-geometry cache, so post-motion local refresh stops rebuilding `x:y:heading` signature strings that runtime code never reads.
- Collapse wheel-surface result summarization into one pass so effective surface, representative offset, and track-limits ownership no longer rescan the same four wheels with separate reductions on every refresh.
- Keep scratch-backed wheel-surface classification on a reusable summary accumulator whose track-limit result is the stable `car.trackLimitState` object, so connector, pit-analytic, full-sample, and main-track refreshes write wheels, representative state, effective surface, and limit ownership in the classifier pass instead of rescanning the four wheels afterward.
- Share the projected wheel half-width across the four same-heading main-track wheel patches during the internal analytic apply path and fold analytic wheel writes plus summary into one pass, so the normal local wheel refresh stops recomputing the same projection term four times before summarizing the result again.
- Replace advanced-physics wheel-surface aggregation and left/right wheel-drag resistance `filter()` / `reduce()` passes with direct scalar loops, removing per-step array churn from the hot advanced integration path while preserving the existing wheel-state contract.
- Stop broad race-state commits from re-filtering the field for per-car aggression updates, and collapse the common race-order path into one live/DNF partition before sorting.
- Skip the excluded-participant reset scan on the normal broad-commit path when the ordered list already covers every car, and derive live field depth from the ordered live/DNF boundary instead of another per-commit reduction over the full field.
- Keep the common running `orderedCars()` path off unnecessary `id -> car` maps and redundant finished/DNF filters, so broad race-state commits only pay those lookup structures in the finished, classified, or frozen-order branches that actually need them.
- Trim the hot running `orderedCars()` path further by sorting the live field in place and appending DNF cars directly instead of cloning and reassembling extra arrays on the common branch.
- Reuse the already-built broad-commit ordered field inside finish evaluation instead of recomputing race order again at the end of every normal step, and enforce `0` finish-evaluation ordered-field rescans on the benchmark path.
- Fold timing-sample recording and timing-line crossing updates into the same per-car broad-commit loop that recomputes race distance and lap telemetry, and enforce one timing-state update per car per commit on the benchmark path.
- Keep broad-commit DRS references in a reusable per-car indexed scratch array after the physical-track-order pass instead of rebuilding a transient `Map` just to feed the ordered commit loop, and enforce one indexed DRS scratch build per broad commit on the benchmark path.
- Skip the wrapped-progress physical-order sort inside DRS reference building whenever the active live field still fits inside one lap window, while keeping the old physical-order fallback for lapped-traffic cases where the race order no longer matches the car order on track.
- Let `calculateWheelSurfaceState()` write the representative state directly into the stable `car.trackState` container on the hot `applyWheelSurfaceState()` path, removing the temporary representative-state object and follow-up copy from local wheel-surface refresh.
- Keep the advanced simulator physics path on scalar heading axes inside `integrateSimulatorVehiclePhysics()`, removing the per-step temporary `vehicleAxes()` object allocation from the hot velocity projection and acceleration reconstruction path.
- Make same-lap leader gap seconds accumulate from already-computed interval gaps inside the ordered broad-commit loop, so the normal running path stops re-estimating a separate leader-vs-car timing gap for every follower when finite interval timing is already available.
- Rework swept collision narrowphase to interpolate body-only rectangles into reusable scratch shapes instead of rebuilding full temporary vehicle geometry for every sweep step.
- Reuse SAT projection scratch and keep collision narrowphase on direct scalar axis checks instead of rebuilding per-axis projection objects and temporary axis arrays through repeated body-body overlap tests.
- Keep collision narrowphase contact results, metadata wrappers, and contact-axis containers in reusable scratch storage on hot internal calls, while preserving fresh public no-scratch collision result objects.
- Keep collision contact velocity response on scalar `velocityX/Y` math instead of rebuilding temporary vector objects for advanced-mode and pit-fixed contact damping, and pin that path in the runtime collision benchmark.
- Keep collision resolver phase containers in reusable simulation scratch storage, so collidable-car filtering and per-pass reported-contact tracking stay on arrays and typed epoch marks instead of rebuilding arrays or string-key `Set` containers on every collision phase.
- Keep collision steward context assembly on resolver-owned scratch and scalar velocity math, so fresh-contact reviews stop rebuilding spread metadata/vector helper objects before handing facts to the penalty steward.
- Emit collision steward penalties directly into the simulation ledger on the internal review path, so fresh-contact review no longer builds an intermediate penalty array before immediately recording the same payloads.
- Keep collision broadphase candidate de-duplication on scratch-owned typed pair marks, source-indexed distance entries, and reusable missing-distance flag/index arrays instead of object `Map`/`Set` bookkeeping, so hot candidate generation avoids string keys, car-order maps, and fallback sets while preserving the public pair-array result shape.
- Reuse pit-road and pit-box candidate containers inside indexed pit-lane state resolution, and extend the runtime track-query benchmark so pit-transition queries are explicitly exercised with `pitFallbacks: 0`.
- Route normal runoff barrier checks through a tiny local segment-neighborhood projection from the previous committed track frame, so main-track cars stop paying both the full nearest-track query and the broader hinted-arc path every step while pit-bound and teleport-like moves still fall back to the broader indexed query path.
- Reuse the exact local-neighborhood track-state target and returned result wrapper on the common runoff fast path, cutting per-step track-state allocation from post-physics barrier checks without changing runoff query exactness or pit-aware fallback behavior.
- Tighten the runoff fast path so only roughly meter-scale committed motion uses the smallest exact local-segment neighborhood, while larger non-teleport motion widens back to the broader exact neighborhood automatically and keeps the common benchmark path on the cheaper query radius without weakening exactness.
- Narrow pit-aware runoff broadphase to connector-only runtime bounds plus a pit-side off-track gate, so true pit-transition edge cases still fall back to the full pit-aware nearest query without collapsing the benchmark path for normal cars running down the pit straight.
- Replace per-corner runoff barrier reach scans with an analytic body/wheel/visual-footprint reach calculation, keeping barrier contact behavior while removing hot-loop corner projection work.
- Make hinted local arc projections scan deduped arc-bucket candidates directly instead of first materializing transient candidate arrays, cutting runoff and connector-adjacent query overhead without changing geometric tie-breaking behavior.
- Make full snapshot JSON serialization use a cached compact track view with rounded static geometry, decimated exported track samples encoded through `track.sampleSchema`, and no engine-only pit bounds / pit-crew metadata or duplicated pit-box/service-area team fields, cutting repeated full-state export cost without changing the live in-memory track object used by the simulator.

### Fixes And Hardening

- Reuse render snapshot buffers, collision candidate arrays, wheel-surface containers, and timing-tower row nodes in hot paths.
- Synchronize the npm lockfile for clean-checkout installs, including optional transitive `@emnapi` entries that a warm local install can mask during `npm ci --dry-run`.

### Migration Notes

- Update Policy Runner HTTP servers for protocol version `2`: read model inputs from `body.driverIds[index]` plus aligned `body.vectors[index]`, `body.previousActions[index]`, and `body.metrics[index]`, and cache `actionSpec`, `observationSpec`, configuration, `previousActionFields`, and `metricFields` from `/policy/reset`. There is no legacy rich-observation per-decision transport option in Policy Runner server mode.
- Browser mounts, composable simulator APIs, headless environment imports, and data helper imports keep the `3.0.0` public API shape unless they depend on Policy Runner HTTP server payloads.

### Verification Notes

- The normal package handoff gate is `npm run check`.
- The final release gate is `npm run check:release`, which adds slow characterization coverage and the full browser smoke matrix.
- 3.0.0 comparison runs showed real environment stepping faster on the checked worst procedural seeds, including normal-profile seeds `104729`, `4101`, and `47`, and batch-training on the same seeds. A standalone adversarial ray-sensor torture sweep can be slower on kerb/gravel/runoff poses because the current tracer performs more bounded indexed exact validation to preserve driver-precision surface semantics.
- The final seed sweep covered 69 procedural seeds, 447,120 ray builds, 3,129,840 rays, 149,040 wheel classifications, and 1,380 environment steps with zero invalid ray payloads, wheel classifications, observations, nearest fallbacks, or pit fallbacks.

## 3.0.0

### Major Changes

- Add the semantic theme customization system. Themes may be partial, but resolved themes are complete light/dark packages; one-sided light/dark token overrides generate and cache the opposite mode, derivative theme packages cannot invent unknown tokens, component/team theme selectors are supported, and theme plus driver/team colors are validated before becoming CSS variables.
- Make indexed track queries canonical and internal. Browser mounts, headless environments, Policy Runner, model-sense visualization, and hot simulation paths now use the package-owned index, while unsuitable edge cases stay behind focused internal fallback integrations. The public `trackQueryIndex` option is removed.
- Add the playable keyboard demo and pit controls. The local preview now exposes a playable route with steering/throttle/brake controls plus pit request, commit, clear, and target compound commands through the normal expert action fields.
- Finalize the opt-in `driver` camera. Hosts can enable the control with `ui.driverCamera: true` or start directly in it with `initialCameraMode: 'driver'`; the camera follows the selected car from a lower screen anchor, rotates the world around the car heading, respects zoom bounds, and falls back safely when no selected car or snapshot is available.
- Keep `car.trackState` as a documented public snapshot shape with stable car-center track classification fields, and make package readouts tolerate partial startup or external-renderer snapshots without throwing.

### Fixes And Hardening

- Sanitize public URL-like options such as `backLinkHref` so unsafe schemes cannot become clickable package-owned links.
- Sanitize runtime snapshot colors and escape package asset URLs before writing readout CSS values, so external-renderer or partial-snapshot data cannot inject inline style declarations.
- Harden track query correctness and performance with deterministic indexed lookup coverage and progress hints as optimization-only inputs.
- Preserve scheduler cancellation behavior in `createPaddockDriverControllerLoop()` so stopped scheduled playback cancels package-owned and custom scheduler handles cleanly.

### Migration Notes

- Remove any host usage of `trackQueryIndex`; indexed queries are always canonical/internal in 3.0.0.
- Rename the strict physics mode from `physicsMode: 'simulator'` to `physicsMode: 'advanced'`. The old string is no longer accepted and falls back to the default `physicsMode: 'arcade'`.
- Prefer the semantic `theme` contract over one-off color aliases. Legacy aliases such as `accentColor`, `greenColor`, and `yellowColor` still map to semantic tokens for migration.
- Use `ui.driverCamera: true` when the generated camera controls should expose the Driver button, or `initialCameraMode: 'driver'` when the simulator should start in driver camera mode.
- `backLinkHref` now accepts only relative URLs, hash URLs, and absolute `http:` / `https:` URLs; unsafe or malformed values fall back to the package default.

### Verification Notes

- The normal package handoff gate is `npm run check`.
- The final release gate is `npm run check:release`, which adds slow characterization coverage and the full browser smoke matrix.

## 2.0.1

### Patch Changes

- Harden the simulator training environment and model-facing sense contract. This patch keeps vector-only observations aligned with full object observations, keeps indexed ray acceleration equivalent to the legacy ray contract for driver-facing senses, preserves stable terminal-car and pit-route state during training loops, and documents the stricter model-sense boundary.

## 2.0.0

### Major Changes

- Promote the `v6` simulator work as the next major PaddockJS release. This release keeps the package boundary focused on browser-mounted simulator components, composable simulator surfaces, and browser-free JavaScript environment/control APIs.
- Add the stricter opt-in `physicsMode: 'advanced'` vehicle model with 2D velocity/yaw dynamics, traction limits, speed-sensitive steering, steering scrub, slip telemetry, reduced off-road grip, and advanced-mode AI tuning. The default remains `physicsMode: 'arcade'` for existing hosts.
- Add richer procedural track generation with semantic profiles (`race`, `training-short`, `training-medium`, and `training-technical`), validated connected-region centerlines, profile-level generation controls, deterministic `trackGeneration` options, DRS zones, pit-lane access geometry, and cached track query indexes.
- Add hard barrier-wall consequences and opt-in stalled off-track DNF handling. Barrier contact now marks cars destroyed/DNF in both physics modes, while `rules.modules.stalledDnf` can retire cars that remain stopped off legal surfaces.
- Expand the headless environment contract for real training loops: compact vector/object/full observation output, optional `Float32Array` vectors, schema caching, no-state/minimal/full result output, per-driver episode info, selected-driver resets, reset-only scenario placements, reward normalization, evaluation helpers, rollout metrics, and a shared driver-controller loop.
- Add physical-driver observation support with richer body/boundary/contact senses, opponent radar, configurable ray layouts, surface-aware ray channels, driver/debug precision modes, and model-sense visualization that renders the active observation rather than recomputing browser-only values.
- Add participant interaction profiles and replay ghosts for training/comparison workflows. `batch-training`, `isolated-training`, and related profiles can make real physics participants non-colliding, sensor-hidden, pit-non-blocking, or race-order-excluded, while replay ghosts remain separate trajectory overlays outside car physics/rules.
- Add Policy Runner support for the three package-supported controller paths: browser-run distilled policy playback, JSON policy-server action loops, and live preview streams for externally rendered snapshots.
- Add Python bridge examples for policy-server integration through `examples/python/base_policy_server.py` plus a minimal `requirements.txt`.
- Add UI/runtime controls for simulation speed, external rendering/live preview, replay ghost drawing, no-collision markers, debug-only physics-mode indicators, runtime warmup, visibility-aware frame loops, and reduced high-speed DOM refresh cost.

### Package UI And Showcase

- Rework the tracked `local-preview` showcase into release coverage pages for templates, components, API controls, behavior/layout contracts, stewarding, collision lab, Policy Runner, and rules.
- Add generated showcase coverage cards and hideable example-code panels so each documented mount/control path has an accurate colocated example.
- Add the Rules page and update showcase navigation across all tracked pages.
- Clean up showcase composition bugs around loaded simulator heights, placeholder min-heights, section-title wrapping, empty/wrong code examples, and host embed overflow.
- Remove the old standalone `expert-environment.html` page after folding the supported environment/control coverage into the broader docs and Policy Runner paths.

### Architecture And Maintenance

- Split large facade files into feature-owned modules for app banners, camera control, readouts, rendering, runtime lifecycle, sensors, track generation/querying, pit flow, race lifecycle, race order, race finish/classification, rules, timing, driver control, vehicle physics, and snapshots.
- Keep compatibility barrels thin while moving implementation into canonical feature directories such as `src/simulation/track/`, `src/simulation/vehicle/`, `src/simulation/driver/`, `src/simulation/timing/`, `src/simulation/pit/`, `src/environment/sensors/`, and `src/app/`.
- Add fast/slow Vitest mode helpers, release browser-smoke coverage, local-preview markup regressions, policy-runner encoder/server tests, warmup tests, physics-mode tests, expert sensor renderer tests, and a track-query-index benchmark script.
- Update package release gates so `npm run check` runs fast tests, public type checks, dry pack, packed-consumer smoke, tracked showcase build, and quick Chromium smoke; `npm run check:release` adds slow characterization and the full browser smoke matrix.

### Fixes And Behavior Cleanup

- Ensure browser expert teardown destroys the expert adapter and detaches external renderer subscriptions.
- Preserve external renderer driver IDs when incoming live-preview frames already use local simulator driver IDs.
- Keep browser expert rendering stable when compact environment result options request no returned state payload.
- Validate missing/non-finite controlled-driver actions instead of silently applying stale or zero controls.
- Keep environment reset behavior stable when partial reset options omit nested groups or intentionally replace scenario placements.
- Keep no-collision participants and replay ghosts aligned across rendering, sensors, race order, collision, pit occupancy, and public snapshots.
- Keep model-facing observations and visual sensor overlays aligned to the active observation contract, with debug precision reserved for labeled diagnostics.
- Make the debug physics-mode square opt-in through `debug.physicsModeIndicator` and hidden by default for package consumers.
- Remove the deleted `training-lab` workflow from the package boundary; release artifacts include supported docs/examples only.

### Documentation

- Add the Custom Model Controller Guide for wrapping a trained model as a batched controller usable from browser playback or headless loops.
- Expand README, system specs, data contract, training guide, rules, concepts, architecture notes, learnings, and install/update workflow for the new simulator, environment, Policy Runner, showcase, and release-gate behavior.
- Document the Python policy-server boundary as an example bridge, not a packaged Python Gymnasium/PettingZoo integration.

### Known Future Scope

- Weather effects, reliability failures, fuel-load performance effects, static obstacles, debug mutation APIs, assisted controls, and packaged Python Gymnasium/PettingZoo wrappers remain intentionally out of 2.0.0.

## 1.0.0

### Major Changes

- Promote PaddockJS to the first stable release for reusable browser embeds and headless JavaScript training/control workflows. The package now exposes the production simulator through `mountF1Simulator()`, composable mount helpers through `createPaddockSimulator()`, and a browser-free environment API through `@inventure71/paddockjs/environment`.
- Stabilize the 1.0 race-simulation feature set around pit-lane and pit-stop behavior, stewarded penalties, more realistic vehicle geometry and wheel-level surface handling, improved timing/DRS data, and lower-cost simulation/runtime paths.

### Race Simulation

- Add deterministic procedural tracks with pit-lane geometry, service areas, team queue slots, garage boxes, legal pit-lane surfaces, pit entry/exit routes, pit-lane open/closed state, and red-flag gating.
- Add automatic and host-controlled pit-stop intent, target tire compounds, service timing, penalty service before tire work, team queue behavior, pit-service countdown display, and optional pit-crew service variability.
- Add penalty ledger support for time, drive-through, stop-go, position-drop, grid-drop, and disqualification consequences, including service/cancel/final-classification conversion behavior.
- Enforce track limits from all four wheel contact patches, not car center position, and resolve each car's physics surface from the worst wheel surface.
- Add pit-lane speeding steward enforcement on speed-limited pit-lane parts while keeping pit-entry and pit-exit connector roads legal but not speed-limited.
- Use body-hull car collision geometry instead of transparent sprite bounds, with swept checks to prevent endpoint tunneling and contact metadata for callbacks/debugging.
- Fix lapped-traffic collision fault assignment so rear contact is judged by physical track order rather than cumulative race distance.
- Fix DRS detection so physically-ahead lapped traffic can be the DRS reference car.
- Improve race timing with fixed timing-line crossing history, interval and leader-gap modes, lap-gap labels for lapped cars, sector telemetry, provisional waved-flag status, and final classification after the full field finishes.

### Performance And Runtime

- Cache per-car geometry and wheel-surface state for repeated collision, surface, snapshot, and debug consumers.
- Reduce collision candidate work with circular-track distance-window pruning before swept AABB/SAT checks.
- Reduce headless/runtime cost by avoiding repeated full snapshot serialization during frame skips and by adding lean render/observation snapshot paths.
- Reduce observation cost by reusing ray-origin track state and broadphasing ray/car tests before exact footprint intersection.
- Reduce browser work by throttling noncritical DOM/timing refreshes at high playback speeds, reusing supplied snapshots for camera-control availability, caching stable pit-lane status graphics, pruning DRS trail histories in place, and skipping repeated text/markup writes.

### Public API And Docs

- Add and document the expert/headless environment API, action and observation specs, starter progress reward helper, rollout recorder/evaluation helpers, and worker-protocol wrapper.
- Add public controller methods for safety car, red flag, pit-lane open/closed state, pit intent/compound control, and penalty serve/cancel controls.
- Add the `ui.simulationSpeedControl` TypeScript option and document the browser playback speed control.
- Expand local preview and browser smoke coverage for templates, composable mounts, API controls, behavior, stewarding, collision lab, expert environment, and policy runner pages.
- Update package docs for 1.0 behavior, data contracts, architecture boundaries, rules, training/control usage, and installation/update workflow.

### Known Future Scope

- Weather effects, reliability failures, and fuel-load performance effects remain intentionally out of 1.0.0 and are tracked as future work.

## 0.3.0

### Minor Changes

- eabe042: Prepare the major 0.3.0 feature release with published-package docs, runtime restart hardening, and the first expert environment API. Public install docs now target npm consumption, package dry-run contents exclude repo-agent files and unexported standalone code, lockfiles are synchronized to the package version, host driver/entry validation rejects duplicate IDs, invalid lap counts normalize to one-lap races, restart can rebuild deterministic tracks from a new `trackSeed`, asset URL changes are explicitly remount-only, and rerender paths destroy replaced PixiJS display children. The release also adds a browser-free JavaScript environment contract through the `@inventure71/paddockjs/environment` subpath and an opt-in browser expert wrapper that reuses the visual simulator's race state, including opt-in in-canvas ray sensor visualization for controlled expert drivers, center-origin geometry-based ray detection for track exit/re-entry transitions and car footprints, a starter `createProgressReward()` callback, and a dependency-free headless training/evaluation example. It also documents the bring-your-own-model boundary, adds environment action/observation specs, and includes a visual policy-runner example that demonstrates `policy.predict(observation)` driving browser expert mode without adding ML dependencies or model persistence.

## 0.2.0

### Minor Changes

- 846f388: Add detached telemetry surfaces, sector timing status colors, a broadcast sector banner, and a race telemetry drawer template with embedded timing tower, safety-car control, and lower-third race data.

### Patch Changes

- 21cf4e5: Document the official release workflow and switch automated publishing to npm trusted publishing through GitHub Actions.

All notable changes to this project will be documented in this file.

The npm release workflow updates this changelog from committed Changesets.
