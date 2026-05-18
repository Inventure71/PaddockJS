# Learnings

This file records implementation lessons that should influence future PaddockJS changes.

## Overlay Layouts Need Internal Safe Areas

When a package-owned preset overlays one component on top of another, the preset must reserve a safe area for every affected layer:

- The visual overlay itself.
- Canvas camera framing.
- Canvas-hosted controls.
- Start lights.
- Lower-third and radio banners, unless the intended broadcast treatment is to overlay them across the full combined grid.
- Any internal rows, headers, grids, or readouts inside the overlay.

The left timing-tower overlay exposed this risk. Shrinking the tower container was not enough, because the timing rows still used the wider default timing-column grid. The result was a horizontal scrollbar inside the tower entries even though the outer tower size was package-controlled.

The rule is: do not only constrain the outer component. Also verify that all child grids and fixed-width pieces can compress within the new preset.

## Presets Own Their Internal Ratios

For all-in-one layout presets, hosts may scale the full mounted simulator through the container. Hosts should not be given raw width, max-width, or horizontal-ratio options for internal preset pieces.

If a host needs full layout ownership, it should use the composable API and mount package-owned pieces separately:

```js
const simulator = createPaddockSimulator(options);
simulator.mountRaceCanvas(canvasRoot, { includeRaceDataPanel: true });
simulator.mountTimingTower(timingRoot);
await simulator.start();
```

Avoid adding public options like `timingTowerWidth`, `timingTowerMaxWidth`, or arbitrary column ratios. Prefer named package-owned variants if a second layout is genuinely needed.

When the race-data lower-third must overlay the timing tower while staying clipped inside the race window, keep it inside the race canvas with `includeRaceDataPanel: true`. Mounting it as a sibling root gives the host responsibility for stacking contexts and can put the banner underneath the timing tower.

## Layout Verification Standard

For visual layout changes, verify more than the happy path screenshot:

- Desktop, tablet, and narrow mobile widths.
- Standard and overlay presets.
- `scrollWidth <= clientWidth` for shell, canvas panel, timing tower, timing list, timing rows, column header, race-data panel, telemetry, car overview, camera controls, and topbar controls.
- Overlay safe-area geometry: external camera controls must stay outside the race view, while race-data banners are allowed to overlay the tower but must remain centered and clipped inside the race window.
- Browser smoke against an installed/bundled host, not only string-based unit tests.

Unit tests should cover the contract, but browser geometry checks catch CSS interactions that tests can miss.

## Indexed Track Queries Must Reach Every Runtime Path

The track query index is internal performance infrastructure, not a separate sensor contract. When a runtime opts into it, every simulation instance used by that runtime must receive the same option:

- Headless environments created by `createPaddockEnvironment()`.
- Browser expert mode through `F1SimulatorApp.createRaceSimulation()`.
- Policy Runner controller-debug configurations.
- Local preview remount/restart paths.
- Any benchmark or smoke path used to validate training behavior.

Do not assume that setting `trackQueryIndex: true` on a high-level preview or environment config is enough. Trace the option all the way into `createRaceSimulation()` and verify that the live simulation owns a non-enumerable `track.queryIndex`. The index must stay out of public JSON contracts: it may exist on the in-memory track object, but `Object.keys(snapshot.track)` must not expose `queryIndex`.

The failure mode to avoid: headless training uses indexed queries and looks fast, while the browser visual/expert simulation silently drops the option and falls back to legacy `nearestSampleInRange()` scans near barriers, recovery starts, or far-off-track positions. This can make the Policy Runner lag even when the model, heuristic controller, and ray contract are correct.

Verification for index-related changes should include both layers:

- A focused unit test proving the app or environment path forwards `trackQueryIndex` into the created simulation.
- A browser reproduction or smoke check against the Policy Runner or relevant visual runtime, especially near barrier/recovery geometry where legacy nearest-sample scans are most expensive.
- A profile or timing check when the bug is performance-related. If `nearestSampleInRange()` is still hot in an indexed browser path, the option did not reach the live simulation or another code path is bypassing the index.

Do not fix browser performance by changing model-facing sensor precision, hiding observations, or showing debug-only values. The active observation contract remains the source of truth: policies receive it, Policy Runner visualizes it, and the index only changes how the same values are computed.
