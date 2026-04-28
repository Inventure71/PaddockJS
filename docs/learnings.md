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
simulator.mountRaceCanvas(canvasRoot);
simulator.mountTimingTower(timingRoot);
await simulator.start();
```

Avoid adding public options like `timingTowerWidth`, `timingTowerMaxWidth`, or arbitrary column ratios. Prefer named package-owned variants if a second layout is genuinely needed.

## Layout Verification Standard

For visual layout changes, verify more than the happy path screenshot:

- Desktop, tablet, and narrow mobile widths.
- Standard and overlay presets.
- `scrollWidth <= clientWidth` for shell, canvas panel, timing tower, timing list, timing rows, column header, race-data panel, telemetry, car overview, camera controls, and topbar controls.
- Overlay safe-area geometry: camera controls must start to the right of the overlay tower, while race-data banners are allowed to overlay the tower but must remain centered and clipped inside the race window.
- Browser smoke against an installed/bundled host, not only string-based unit tests.

Unit tests should cover the contract, but browser geometry checks catch CSS interactions that tests can miss.
