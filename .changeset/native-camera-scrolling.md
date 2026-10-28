---
"@inventure71/paddockjs": patch
---

Drive Grid Walk browsing and Race camera zoom through browser-native scrolling instead of canceling wheel handlers, avoiding the nonpassive-listener trigger for macOS Gecko cross-tab scroll stalls. Preserve the fixed canvas, axis-constrained camera, selection, simulation progress, page handoff and input cleanup.
