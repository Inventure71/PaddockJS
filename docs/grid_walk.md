# Grid Walk

Grid Walk is an opt-in browser presentation around the existing race. It stages the same cars on the same track, adds preparing crew and readable entry labels, and provides an entry inspector. Both mounting APIs support it. Existing consumers continue to start in Race without Grid Walk UI.

```js
const simulator = createPaddockSimulator({
  drivers: [{ id: 'surveyor', name: 'Surveyor', color: '#f05060' }],
  entries: [{
    driverId: 'surveyor',
    presentation: {
      name: 'Surveyor Field Workspace',
      summary: 'Map field observations in a shared workspace.',
      technologies: ['TypeScript', 'WebGL'],
      details: ['Offline observations', 'Shared project maps'],
      image: { src: '/images/surveyor.webp', alt: 'A field map with observation markers' },
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
- Before the first departure from Grid Walk, the simulation clock and lights are held. Choosing Race clears the crew over 650 ms of visible activity, then starts the existing deterministic lights sequence. With reduced motion or motion paused, clearing is immediate. Returning during clearing cancels the transition.
- Returning after playback has begun pauses the exact live race and shows its original starting grid using display poses only. Race resumes saved time, laps, order, tires, pit state, selected entry and fractional fixed-step remainder. The simulation object, RNG, entries and track are not recreated or changed by browsing or resizing. Inspector selection/open state survives a mode switch.
- Standing starts use actual assigned grid distances and offsets, including penalties present when the presentation is captured. With `rules.standingStart: false`, staging uses display-only staggered slots; Race resumes the existing rolling-start state without adding a lights sequence.
- Explicit `restart()` still creates a new race, captures its grid and applies the configured initial view. Nested Grid Walk options merge on restart. Resizing and mode switches never implicitly restart.
- Grid Walk is excluded from `expert.enabled`: expert/reset/step callers own their separate lifecycle. Combining these opt-ins throws during option resolution.

## Entry content and links

`presentation` may be supplied on a driver or its matching entry. The entry's presentation takes precedence. `name` falls back to the driver's full name, `summary` to its first legacy `raceData` item, and `details` to its remaining items. Missing technologies, details, images and links are omitted. Content is rendered as text, not HTML.

`href` falls back to the driver's `link`. Navigation is an ordinary anchor supporting browser open/copy/modifier behavior; Grid Walk does not route through `onDriverOpen`. That existing callback remains available on the legacy race banner. Hosts supply all destinations. Link and image URLs accept relative, hash, HTTP and HTTPS URLs through the package's URL normalization; script, data and protocol-relative URLs are excluded. Images need meaningful alt text, or an empty alt for decoration.

Appearance follows existing package theme tokens for text, surfaces, borders, primary and focus colors. No host-specific names, categories or routing are embedded in the runtime.

## Camera and accessibility

The measured canvas host's width and height choose composition, independent of viewport, device or user-agent. Wide starts horizontal, tall starts vertical. A retained orientation uses a ratio band of 0.92–1.08 near square to avoid flapping. The camera rotates and frames the same world. The grid and entries are never rebuilt or reordered for another orientation.

The camera frames one to three labeled entries according to available space, reserving room for the inspector and controls. Full names remain readable HTML text; summaries are visually clamped on scene labels, with full supplied content in the inspector. Previous/next and a native entry selector reach the whole grid without shrinking every label to fit at once. Graphical cars and semantic labels select the same entry identity.

In constrained all-in-one embeds, the opt-in shell also uses its container width for the existing stacked timing/telemetry composition. Overlapping timing towers clear the Grid Walk scene and return in Race; outboard towers retain their layout. Timing-board width tokens are unchanged.

Controls are keyboard-operable. Selection focuses the nonmodal inspector heading; Escape or Close restores the selected label. Links keep ordinary browser behavior. The inspector scrolls independently. Focus is not trapped because the grid remains available.

Pause motion freezes crew activity while retaining the scene. `prefers-reduced-motion` disables ambient motion and inspection entrance animation and makes clearing immediate; live changes are respected. Crew geometry is created once and only transforms change during animation. Existing visibility/activity handling pauses unnecessary rendering when hidden. Static Grid Walk stops the ticker and draws only for interaction/layout changes. Race logic and simulation updates are skipped while browsing.

Very small containers retain the package's minimum-size limits. Provide at least 320 px width and enough height for the scene and inspector. The showcase exercises 374 × 460, 390 × 760, 640 × 640 and 1120 × 620 hosts. Unusually long content scrolls in the inspector.

## Startup, failure and recovery

Grid Walk shares existing renderer/asset startup and teardown ownership. A failed `mountF1Simulator()` rejects and releases its root; invoke the mount function again to retry. For a composable controller, await the rejected `start()` and call `start()` again on the mounted components. If `destroy()` cancelled a pending start, await settlement, remount required surfaces and then call `start()`.

Hosts must restore Retry in a `finally` block and explicitly call their mount/start operation. Importing a cached module does not execute its side effects again. That host-loader wiring is outside this package. Test unpublished changes in the package showcase or a temporary packed consumer.

## Verification surface

Run the showcase and open `/grid-walk.html`. Host size controls change actual component dimensions without replacing the simulation. Normal and full browser gates exercise keyboard focus, canvas mouse/touch selection, every entry, resizing, state preservation, reduced motion, image/link content and destroy/remount with cached assets. Focused tests cover deterministic progress equivalence, display-only staging and camera hysteresis.
