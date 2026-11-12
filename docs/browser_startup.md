# Browser startup responsiveness

Browser mounting prepares track geometry and draws the scene cooperatively. Automatic Grid Walk starts without a host interaction. Public mount/start promises, ready callbacks, synchronous restart and `createProceduralTrack()` contracts are unchanged.

## Task boundaries and ownership

`src/app/runtime/startupTasks.js` supplies cancellation-aware checkpoints with an 8 ms work budget and real timer-task yields. Microtasks alone cannot release the main thread for input or painting. Track generation yields between candidate construction and validation, and before publishing immutable cached geometry. The existing simulation factory retains ownership of warmup, RNG and mutable race state. Synchronous and asynchronous generation share candidate order, mathematics and cache behavior.

`ProceduralTrackAsset.renderAsync()` consumes the same drawing steps as synchronous rendering. Kerb and border safety queries yield within expensive loops. Every partially built Graphics object is attached to the owned scene before a pause, so destruction releases it. The scene remains non-renderable, its ticker stopped, and its Grid Walk controls inert until construction finishes. Startup renders one complete initial frame before clearing loading state and delivering ready callbacks. Cancellation is checked at task resumptions and before publishing the prepared simulation; a disposed startup cannot restore resources or deliver ready.

## Measured portfolio workload

Measured on 2026-11-12 using an isolated copy of the portfolio Projects page and its real automatic loader, seven F1 entries, simulation seed 71 and track seed 7110. The browser used Apple M4 Pro hardware through ANGLE Metal, viewport 1280×800, DPR 2, with no CPU throttling. Each variant used three fresh page navigations. Diagnostic builds recorded function spans, Long Tasks API entries and an 8 ms timer heartbeat; asynchronous span durations include time yielded to the browser. Baseline and candidate runs were grouped rather than alternated, so these are local ranges, not a general device guarantee.

| Metric | Before | After |
| --- | ---: | ---: |
| Longest startup main-thread task | 597–627 ms | 62–71 ms |
| Longest heartbeat interval | 607–634 ms | 78–86 ms |
| Worst scheduled navbar-handler delay | 598–625 ms | 64–76 ms |
| Initialization until ready | 918–978 ms | 1243–1372 ms |

The baseline spent 224–240 ms in simulation preparation and 537–555 ms drawing the track, predominantly borders (407–418 ms) and kerbs (124–130 ms). Individual geometry candidates took roughly 30–54 ms. Texture loading included asynchronous waits; the candidate first render took 47–50 ms. Initial DOM readouts took about 2 ms, so deferring unused UI was not justified. Cooperative scheduling increases elapsed startup time by roughly 0.3–0.4 seconds while substantially reducing individual stalls. No worker or texture-preparation rewrite was needed for this measured workload. GPU initialization and individual geometry candidates can still exceed the 8 ms scheduling budget because checkpoints cannot preempt an atomic operation.

A separate real navbar click at 768×900 occurred while both initialization and track drawing were pending. The unrelated navbar expanded before startup completed; its First Input entry reported 1.3 ms processing delay and 8 ms duration. This real input measurement is separate from the scheduled-handler comparison above. Baseline and candidate initial simulation snapshots had identical SHA-256 hashes for the fixed workload.

## Regression verification

`startupTasks.test.js`, `runtimeStartup.test.js`, `proceduralTrackAsync.test.js` and `proceduralTrackAsset.test.js` cover real task turns, sync/async parity, cancellation before cache commit and during scene construction, destruction at promise completion, partial resource cleanup and retry. Grid Walk browser smoke covers automatic startup, loading-scale transitions, late overlay resizing, both start-line orientations, input and remounting. Run the package release gate and runtime benchmark for changes to these paths. Repeat host profiling with the real stylesheet/loader, a fixed workload and recorded renderer metadata; distinguish elapsed preparation from blocking task duration.
