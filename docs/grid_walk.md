# Grid Walk

Grid Walk is an opt-in browser presentation around the existing race. It stages the same cars on the same track, adds preparing crew, visitors walking along the grid and readable entry labels, and reuses the race project banner at the bottom. Both mounting APIs support it. Existing consumers continue to start in Race without Grid Walk UI.

```js
import { createPaddockSimulator } from '@inventure71/paddockjs';

const simulator = createPaddockSimulator({
  drivers: [{ id: 'surveyor', name: 'Surveyor', color: '#f05060' }],
  entries: [{
    driverId: 'surveyor',
    presentation: {
      name: 'Surveyor Field Workspace',
      summary: 'Map field observations in a shared workspace.',
      href: '/projects/surveyor',
      linkLabel: 'View project',
    },
  }],
  gridWalk: { enabled: true, initialView: 'grid-walk', ambientMotion: true },
  ui: { viewControls: 'toggle' }, // Omit for the two-button Grid Walk / Race switch.
});
simulator.mountViewControls(document.getElementById('sim-view-controls'));
simulator.mountRaceCanvas(document.getElementById('sim-race'));
await simulator.start();
simulator.setView('race');
```

## Host composition

The Grid Walk / Race switch is a separately mountable package component. Place `simulator.mountViewControls(controlsRoot)` outside the scene alongside `mountRaceCanvas(canvasRoot)`, before `await simulator.start()`. The equivalent function-style helper is `mountViewControls(controlsRoot, simulator)`, imported from the browser package. It uses the package's control styling and calls the same `setView()` API; it does not create another simulator. `ui.viewControls` selects `'switch'` (the default Grid Walk / Race buttons) or `'toggle'` (one ordinary action button). The toggle reads **Start race** in Grid Walk with a green fill and **Stop race** in Race with a red fill, using the semantic `theme.colors.greenFlag` / `redFlag` colors in both themes. Stop pauses exact progress and presents the original display grid; Start resumes it through the same lifecycle below, without restarting the race. Invalid option values fall back to `'switch'`. Both variants use the same `mountViewControls()` API and remain synchronized after `restart({ ui: { viewControls: ... } })`.

A standalone race canvas does not insert a mode switch. Composable hosts must mount the switch explicitly or provide their own buttons calling `setView()`. The all-in-one shell and `mountRaceTelemetryDrawer()` already compose the package switch above the scene when Grid Walk is enabled. Mounted switches share the active view, remain disabled until runtime startup completes, and hide when Grid Walk is disabled, including after a restart. The top entry selector and bottom project banner remain part of the scene. The selector is horizontally centered with centered entry text. The external workbench camera controls fill their available row, and action controls reserve the wider of their labels so Start/Stop or Telemetry/Close changes do not shift neighboring controls.

## Lifecycle and state

- `gridWalk.enabled` defaults to `false`. When enabled, `initialView` defaults to `'grid-walk'`; use `'race'` to begin playback with Grid Walk available afterward. `ambientMotion` defaults to `true`.
- `getView()` returns `'grid-walk'` or `'race'`. `setView(view)` returns `true` for an accepted change and `false` for an unchanged/invalid view, disabled Grid Walk, or a composable controller that has not started. View changes do not call `restart()`.
- Before the first departure from Grid Walk, the simulation clock and lights are held. Choosing Race clears the crew over 650 ms of visible activity, then starts the existing deterministic lights sequence. With reduced motion or `ambientMotion: false`, clearing is immediate. Returning during clearing cancels the transition.
- Returning after playback has begun pauses the exact live race and shows its original starting grid using display poses only. Race resumes saved time, laps, order, tires, pit state, selected entry and fractional fixed-step remainder. The simulation object, RNG, entries and track are not recreated or changed by browsing or resizing. Project banner selection/open state survives a mode switch.
- Standing starts use actual assigned grid distances and offsets, including penalties present when the presentation is captured. With `rules.standingStart: false`, staging uses display-only staggered slots; Race resumes the existing rolling-start state without adding a lights sequence.
- Explicit `restart()` still creates a new race, captures its grid and applies the configured initial view. Nested Grid Walk options merge on restart. Resizing and mode switches never implicitly restart.
- Grid Walk is excluded from `expert.enabled`: expert/reset/step callers own their separate lifecycle. Combining these opt-ins throws during option resolution.

## Entry content and links

`presentation` may be supplied on a driver or its matching entry. The entry's presentation takes precedence. `name` falls back to the driver's full name and `summary` to its first legacy `raceData` item. The bottom banner uses the same project name, driver number, position/code, summary and project link fields as the race banner. It initially shows the selected entry; clicking a car/label or changing the top selector updates it. Rich metadata fields (`technologies`, `details`, `image`) remain accepted for host compatibility but are not displayed. There is no separate inspector or expanded information. Content is rendered as text, not HTML.

`href` falls back to the driver's `link`. Navigation is an ordinary anchor supporting browser open/copy/modifier behavior; Grid Walk does not route through `onDriverOpen`. That existing callback remains available on the legacy race banner. Hosts supply all destinations. URLs accept relative, hash, HTTP and HTTPS URLs through the package's URL normalization; script, data and protocol-relative URLs are excluded.

The external mode switch and in-scene entry selector reuse the race camera-control styling. Project details reuse the actual race banner template, renderer and compact variant; only navigation uses an ordinary anchor in Grid Walk. Appearance follows existing package theme tokens for text, surfaces, borders, primary and focus colors. No host-specific names, categories or routing are embedded in the runtime.

## Camera and accessibility

The measured canvas host's width and height choose composition, independent of viewport, device or user-agent. Wide starts horizontal, tall starts vertical. A retained orientation uses a ratio band of 0.92–1.08 near square to avoid flapping. The camera rotates and frames the same world. The grid and entries are never rebuilt or reordered for another orientation.

The camera measures the wrapping top controls and shared bottom banner to reserve a safe scene area. It keeps a stable scale for that area and a single world position along the original grid axis. Selecting an on-screen car changes the project without resetting the camera, zoom or other labels. Previous/next and the native selector bring offscreen entries into view; Home explicitly recenters the selected entry. Resizing, rotation and mode switches preserve the browsing position.

Drag the canvas or an entry label with a mouse or touch to move along the grid. All camera input uses the same axis: horizontal composition accepts left/right dragging and arrow keys, vertical composition accepts up/down. Diagonal drags and scroll cannot move across that axis. A vertical wheel travels front to rear in both compositions; horizontal trackpad input is accepted only in horizontal composition. Browsing is bounded near the grid. The canvas consumes wheel input only while it moves the grid camera; continuing past an end scrolls the host page. Race zoom does not handle wheel input while Grid Walk owns the scene. Ctrl/Meta wheel remains available to browser zoom, and scrolling outside the canvas keeps normal host behavior. Host-handled and non-cancelable wheel events are left alone; modified keyboard navigation such as Ctrl/Cmd+Home keeps its browser behavior. Race releases wheel events at zoom limits and restores native touch scrolling. Only active Grid Walk applies `touch-action: none` to its canvas/entry drag targets; it never changes body/document overflow. A drag starting on a car or label does not select it; a click or tap does, including a gesture that moves only in the forbidden direction.

HTML labels follow the actual car poses in two lanes, with connector lines if space requires displacement. Labels are packed as a group, preserving spatial order and preventing collisions with other labels, controls or the banner. When a lane cannot fit all visible cars at readable size, it keeps the entries nearest the camera center. This decision uses geometry, never selection. Every entry remains reachable through the selector and camera. Short scenes use single-line labels so readable entry targets still fit between the controls and banner in either orientation. Full accessible names and native titles remain available when constrained text is truncated. Label surfaces are opaque in both themes.

In constrained all-in-one embeds, the opt-in shell also uses its container width for the existing stacked timing/telemetry composition. Overlapping timing towers clear the Grid Walk scene and return in Race; outboard towers retain their layout. Timing-board width tokens are unchanged.

Controls are keyboard-operable. Selection focuses the project banner title; Escape or Close restores the selected visible label, or the selector if it has been panned offscreen. Dismissal preserves camera position and zoom. The banner follows `ui.raceDataBannerSize`, `ui.showRaceDataPanel`, enabled banner types and the Race mute state; with project banners disabled, selection focuses the entry label instead. Grid Walk keeps project-only content even when Race telemetry detail is enabled. Links keep ordinary browser behavior. Focus is not trapped because the grid remains available.

There is no motion button. Hosts can set `ambientMotion: false` for a static presentation. `prefers-reduced-motion` freezes visitors and crew, disables banner transitions and makes clearing immediate; live changes are respected. Each car has two to five mechanics with varied, stable preparation positions and poses. Visitors have varied clothing and stride and walk from front to rear in a continuous, spatially distributed flow along each side lane. Visitors use deliberately irregular longitudinal spacing, varied lateral paths and individual pace changes and sideways sway. Broad cosmetic offsets hide the underlying coverage cells; bounded movement preserves continuous traffic without drifting into long empty stretches. Their paths extend beyond the full canvas at both ends throughout the permitted camera range, including after resizing, so visitors enter and leave offscreen rather than appearing at a visible spawn point. Camera changes extend the path by filling only newly exposed offscreen coverage without moving existing visitors to new positions. Their cosmetic randomness is independent of the race RNG. People geometry is created once and only transforms change during animation. Camera gestures redraw without reallocating an unchanged renderer. A live reduced-motion preference is also checked by the frame loop so delayed media events cannot leave the ticker running. Existing visibility/activity handling pauses unnecessary rendering when hidden. Static Grid Walk stops the ticker and draws only for interaction/layout changes. Race logic and simulation updates are skipped while browsing.

Very small containers retain the package's minimum-size limits. Provide at least 320 px width and enough height for the scene and controls. Browser checks exercise 320 × 460, 390 × 360, 390 × 760, 640 × 640, 720 × 460, 1120 × 620 and 1400 × 400 hosts. In short containers the shared banner bounds its height and allows its own content to scroll. The project banner retains the race component's text truncation and compact layout.

Dragging releases pointer capture when its window loses focus, its document becomes hidden, or a subsequent pointer move reports no pressed buttons. Returning to the tab never resumes an interrupted drag; a fresh press begins a new gesture.

## Startup, failure and recovery

A successful `restart()` completes loading for any newly created Grid Walk surfaces before rendering the replacement session. Restarted project banners must show their entry content rather than stale startup placeholders.

Grid Walk shares existing renderer/asset startup and teardown ownership. A failed `mountF1Simulator()` rejects and releases its root; invoke the mount function again to retry. For a composable controller, await the rejected `start()` and call `start()` again on the mounted components. If `destroy()` cancelled a pending start, await settlement, remount required surfaces and then call `start()`.

Hosts must restore Retry in a `finally` block and explicitly call their mount/start operation. Importing a cached module does not execute its side effects again. That host-loader wiring is outside this package. Test unpublished changes in the package showcase or a temporary packed consumer.

## Verification surface

For focused Gecko input coverage, install the isolated test browser with `npx playwright install firefox`, then run `npm run browser:smoke:firefox` (or append `-- --skip-build` after a current site build). This checks native wheel ownership outside the simulator and across an independent control tab, Grid Walk boundary handoff, interrupted dragging, and scrolling after switching to Race. It does not run the full Chromium layout/touch matrix. Automated wheel events do not reproduce macOS trackpad momentum phases or establish acceptance in a user's Zen profile.

Run `npm run site:dev` and open `/guide/grid-walk.html`, or use Grid Walk in the main demo at `/`. The main demo uses the single Start/Stop button; the Guide retains the default two-button switch. Host size controls change actual component dimensions without replacing the simulation. Normal and full browser gates exercise keyboard focus, canvas mouse/touch selection and dragging, diagonal wheel and cross-axis keyboard input, label overlap and selection continuity, opaque light surfaces, every entry, live resizing, state preservation, reduced motion, shared banner content/links and destroy/remount with cached assets. Focused tests cover deterministic progress equivalence, display-only staging and camera hysteresis.
