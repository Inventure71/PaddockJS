# Grid Walk

Grid Walk is an opt-in browser presentation around the existing race. It stages the same cars on the same track, adds preparing crew, visitors walking along the grid and readable entry labels, and reuses the race project banner at the bottom. Both mounting APIs support it. Existing consumers continue to start in Race without Grid Walk UI.

```js
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
});
simulator.mountRaceCanvas(root);
await simulator.start();
simulator.setView('race');
```

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

The mode switch and top entry selector reuse the race camera-control styling. Project details reuse the actual race banner template, renderer and compact variant; only navigation uses an ordinary anchor in Grid Walk. Appearance follows existing package theme tokens for text, surfaces, borders, primary and focus colors. No host-specific names, categories or routing are embedded in the runtime.

## Camera and accessibility

The measured canvas host's width and height choose composition, independent of viewport, device or user-agent. Wide starts horizontal, tall starts vertical. A retained orientation uses a ratio band of 0.92–1.08 near square to avoid flapping. The camera rotates and frames the same world. The grid and entries are never rebuilt or reordered for another orientation.

The camera measures the wrapping top controls and shared bottom banner to reserve a safe scene area. It keeps a stable scale for that area and a single world position along the original grid axis. Selecting an on-screen car changes the project without resetting the camera, zoom or other labels. Previous/next and the native selector bring offscreen entries into view; Home explicitly recenters the selected entry. Resizing, rotation and mode switches preserve the browsing position.

Drag the canvas with a mouse or touch to move along the grid. All camera input uses the same axis: horizontal composition accepts left/right dragging and arrow keys, vertical composition accepts up/down. Diagonal drags and scroll cannot move across that axis. A vertical wheel travels front to rear in both compositions; horizontal trackpad input is accepted only in horizontal composition. Browsing is bounded near the grid. A drag starting on a car does not select it; a click or tap does, including a gesture that moves only in the forbidden direction.

HTML labels follow the actual car poses in two lanes, with connector lines if space requires displacement. Labels are packed as a group, preserving spatial order and preventing collisions with other labels, controls or the banner. When a lane cannot fit all visible cars at readable size, it keeps the entries nearest the camera center. This decision uses geometry, never selection. Every entry remains reachable through the selector and camera. Short scenes use single-line labels so readable entry targets still fit between the controls and banner in either orientation. Full accessible names and native titles remain available when constrained text is truncated. Label surfaces are opaque in both themes.

In constrained all-in-one embeds, the opt-in shell also uses its container width for the existing stacked timing/telemetry composition. Overlapping timing towers clear the Grid Walk scene and return in Race; outboard towers retain their layout. Timing-board width tokens are unchanged.

Controls are keyboard-operable. Selection focuses the project banner title; Escape or Close restores the selected visible label, or the selector if it has been panned offscreen. Dismissal preserves camera position and zoom. The banner follows `ui.raceDataBannerSize`, `ui.showRaceDataPanel`, enabled banner types and the Race mute state; with project banners disabled, selection focuses the entry label instead. Grid Walk keeps project-only content even when Race telemetry detail is enabled. Links keep ordinary browser behavior. Focus is not trapped because the grid remains available.

There is no motion button. Hosts can set `ambientMotion: false` for a static presentation. `prefers-reduced-motion` freezes visitors and crew, disables banner transitions and makes clearing immediate; live changes are respected. Visitors have varied clothing, speeds and stride and walk from front to rear along side lanes. Their cosmetic randomness is independent of the race RNG. People geometry is created once and only transforms change during animation. Camera gestures redraw without reallocating an unchanged renderer. A live reduced-motion preference is also checked by the frame loop so delayed media events cannot leave the ticker running. Existing visibility/activity handling pauses unnecessary rendering when hidden. Static Grid Walk stops the ticker and draws only for interaction/layout changes. Race logic and simulation updates are skipped while browsing.

Very small containers retain the package's minimum-size limits. Provide at least 320 px width and enough height for the scene and controls. Browser checks exercise 320 × 460, 390 × 360, 390 × 760, 640 × 640, 720 × 460, 1120 × 620 and 1400 × 400 hosts. In short containers the shared banner bounds its height and allows its own content to scroll. The project banner retains the race component's text truncation and compact layout.

## Startup, failure and recovery

A successful `restart()` completes loading for any newly created Grid Walk surfaces before rendering the replacement session. Restarted project banners must show their entry content rather than stale startup placeholders.

Grid Walk shares existing renderer/asset startup and teardown ownership. A failed `mountF1Simulator()` rejects and releases its root; invoke the mount function again to retry. For a composable controller, await the rejected `start()` and call `start()` again on the mounted components. If `destroy()` cancelled a pending start, await settlement, remount required surfaces and then call `start()`.

Hosts must restore Retry in a `finally` block and explicitly call their mount/start operation. Importing a cached module does not execute its side effects again. That host-loader wiring is outside this package. Test unpublished changes in the package showcase or a temporary packed consumer.

## Verification surface

Run `npm run site:dev` and open `/guide/grid-walk.html`, or use Grid Walk in the main demo at `/`. Host size controls change actual component dimensions without replacing the simulation. Normal and full browser gates exercise keyboard focus, canvas mouse/touch selection and dragging, diagonal wheel and cross-axis keyboard input, label overlap and selection continuity, opaque light surfaces, every entry, live resizing, state preservation, reduced motion, shared banner content/links and destroy/remount with cached assets. Focused tests cover deterministic progress equivalence, display-only staging and camera hysteresis.
