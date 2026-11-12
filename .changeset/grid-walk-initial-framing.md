---
"@inventure71/paddockjs": minor
---

Add optional Grid Walk initialPosition: 'start-line' to align the actual start/finish line near the right or top scene edge. Preserve selected-entry centering by default. Measure framing in local canvas coordinates through host loading-scale transitions and refresh late overlay measurements so first interaction does not change a stale camera frame.

Break browser startup into cancellation-aware tasks during procedural generation and track drawing, preserve automatic Grid Walk, and render one complete initial frame. Keep synchronous generation/restart APIs and deterministic geometry unchanged.
