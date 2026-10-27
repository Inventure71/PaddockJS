---
"@inventure71/paddockjs": minor
---

Add opt-in Grid Walk discovery with preparing crew, full entry names, the shared race project banner and ordinary host-provided links. Adapt the camera to actual wide/tall component dimensions while preserving the same world, selected entry and exact paused race progress. Include keyboard/touch selection, focus restoration, reduced motion and static/hidden rendering suspension. Existing consumers retain Race defaults.

Use the race UI controls and project banner for Grid Walk, add walking grid visitors and support mouse/touch dragging and wheel/keyboard camera browsing. Lock dragging to the camera orientation, keep the selector at the top and project details at the bottom without an extra inspector. Respect reduced motion and host ambient settings without a motion toggle.

Compose camera input, controls, labels, banner and chrome layout as focused components. Constrain every input to the active camera axis, retain framing/label visibility on selection and dismissal, pack labels without collisions in constrained containers, and use opaque themed label surfaces. Honor shared banner sizing/visibility/mute options and snap staging display headings without changing Race smoothing.
