---
"@inventure71/paddockjs": minor
---

Add opt-in Grid Walk discovery with preparing crew, full entry names, the shared race project banner and ordinary host-provided links. Adapt the camera to actual wide/tall component dimensions while preserving the same world, selected entry and exact paused race progress. Include keyboard/touch selection, focus restoration, reduced motion and static/hidden rendering suspension. Existing consumers retain Race defaults.

Use the race UI controls and project banner for Grid Walk, add walking grid visitors and support mouse/touch dragging and wheel/keyboard camera browsing. Lock dragging to the camera orientation, keep the selector at the top and project details at the bottom without an extra inspector. Respect reduced motion and host ambient settings without a motion toggle.

Compose camera input, controls, labels, banner and chrome layout as focused components. Constrain every input to the active camera axis, retain framing/label visibility on selection and dismissal, pack labels without collisions in constrained containers, and use opaque themed label surfaces. Honor shared banner sizing/visibility/mute options and snap staging display headings without changing Race smoothing.

Complete loading for fresh Grid Walk surfaces on restart so entry banners never retain startup placeholders after the renderer is ready.

Use compact labels in short vertical scenes as well as horizontal scenes, keeping long-named entries reachable between the shared controls and project banner.

Move view switching outside the scene with separately mountable package controls. Release wheel scrolling to the page at grid limits and preserve browser pinch/zoom. Extend visitors' routes beyond every reachable camera view without moving existing people on resize, and vary preparation crew counts, positions and activity.

Add `ui.viewControls: 'toggle'` as an alternative to the default Grid Walk / Race switch: a single Start race / Stop race button pauses to the original display grid and resumes saved progress. Center the project selector and its text, fill the available camera-control row, and keep adjacent controls stable when action labels change. Maintain a continuous visitor flow with stable per-lane spacing, bounded gait variation and offscreen-only additions when routes grow.

Color the single Start/Stop action with semantic green/red flag colors in both themes. Give visitors visibly irregular gaps, broader lateral paths and independent bounded pace/sway while retaining continuous coverage and offscreen recycling.
