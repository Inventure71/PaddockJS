# PaddockJS Codebase Cleanup Organization Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Perform a full codebase cleanup and organization pass for the current PaddockJS checkout. The pass must leave the repo demonstrably cleaner while preserving the reusable package boundary, public APIs, package exports, type declarations, snapshot shapes, environment contracts, deterministic simulation behavior, timing-board/broadcast proportions, browser-free environment subpath, and the active model-facing observation contract.

**Architecture:** The earlier broad split plan has already moved the major simulation, rendering, driver, environment sensor, UI template, timing, pit, and rules logic into feature-owned modules. This pass should not retune race behavior or browser proportions casually. It should clean confirmed remaining drift: duplicated restart option merging across mount surfaces, external-renderer responsibilities sitting inside the browser expert adapter, duplicated observation vector construction across object/direct paths, mixed track query index responsibilities, stale docs, and local generated clutter.

**Tech Stack:** JavaScript ES modules, Vite/Vitest, PixiJS, TypeScript declaration checks, npm package and consumer smoke gates.

---

## Files And Responsibilities

- Create `src/config/restartOptions.js`: own behavior-preserving merge of resolved simulator options with restart overrides.
- Modify `src/index.js`: use the shared restart merge helper for `mountF1Simulator().restart()`.
- Modify `src/api/PaddockSimulatorController.js`: use the same shared restart merge helper for composable `restart()`.
- Modify `src/app/F1SimulatorApp.js`: remove unreferenced pass-through methods that no longer own rendering/readout behavior after prior module extractions.
- Create `src/app/BrowserExpertExternalRenderer.js`: own external-renderer source subscription, frame id rewriting, track-surface sync, detach restoration, and state reporting.
- Modify `src/app/BrowserExpertAdapter.js`: keep browser expert environment-runtime wiring local and delegate external-renderer behavior to the focused bridge module.
- Create `src/environment/observationVector.js`: centralize model-facing vector order, schema generation, and vector formatting for both object-backed and direct compact observation paths.
- Modify `src/environment/observations.js`: keep object observation assembly and direct compact-source preparation there, but delegate vector construction to `observationVector.js`.
- Create `src/simulation/track/trackQueryGrid.js`: own generic uniform-grid creation, insertion, candidate lookup, and point-to-cell mapping.
- Create `src/simulation/track/trackQueryPitIndex.js`: own pit-lane road/box grid construction and pit candidate lookup exports.
- Create `src/simulation/track/trackQueryScratch.js`: own reusable query scratch arrays, epoch counters, and ray-trace cache state.
- Create `src/simulation/track/trackQueryStats.js`: own indexed query diagnostic counter shape and update helpers.
- Modify `src/simulation/track/trackQueryIndex.js`: keep public indexed track-query orchestration and delegate grid, pit, scratch, and stats internals to the focused modules.
- Modify `src/__tests__/componentApi.test.js`: add focused tests for shared restart merge behavior, especially preset reset semantics and nested asset/UI merges.
- Modify `docs/architecture.md`: document that restart-option merge behavior is shared config, not duplicated per mount surface.
- Modify `docs/rules.md` and `docs/architecture.md`: align vehicle-physics/geometry ownership references with the canonical `src/simulation/vehicle/` modules.
- Remove only ignored local/generated clutter that is safe to regenerate, such as `.DS_Store`, Playwright console logs, `.pytest_cache`, and built preview output.

## Tasks

### Task 1: Verify Baseline And Live Hotspots

- [x] Record baseline `git status --short` before further edits.
  - Baseline was already dirty with this cleanup work in progress: `docs/architecture.md`, `src/__tests__/componentApi.test.js`, `src/api/PaddockSimulatorController.js`, `src/index.js`, new `src/config/restartOptions.js`, and this plan file.
- [x] Capture source line-count hotspots with:

```bash
find src -name '*.js' -not -path '*/__tests__/*' -print0 | xargs -0 wc -l | sort -nr | head -80
```

- [x] Confirm duplicated restart merge logic with:

```bash
rg -n "function mergeRestartOptions|function mergeResolvedOptions|mergeRestartOptions|mergeResolvedOptions" src src/__tests__ docs README.md
```

### Task 2: Extract Shared Restart Merge Helper

- [x] Add `src/config/restartOptions.js` exporting `mergeRestartOptions(previousOptions, nextOptions = {})`.
- [x] Preserve current semantics exactly:
  - a supplied `preset` resets previous `ui` and `theme` before explicit restart overrides are applied
  - nested `ui.raceDataBanners` values are merged
  - nested `assets.trackTextures` values are merged
  - omitted `drivers` and `entries` keep the previous resolved values
- [x] Update `src/index.js` and `src/api/PaddockSimulatorController.js` to import and use the helper.
- [x] Remove the duplicated local merge functions from both files.
- [x] Remove unreferenced `F1SimulatorApp` pass-through methods for renderer/readout helpers after `rg` confirmed no callers remain.

### Task 3: Add Focused Tests

- [x] Add tests in `src/__tests__/componentApi.test.js` that import `mergeRestartOptions`.
- [x] Test preservation of drivers/entries and nested `assets.trackTextures` merge.
- [x] Test that restart with a new `preset` resets old `ui`/`theme` values while preserving explicitly supplied nested overrides.
- [x] Run the focused test:

```bash
npm test -- src/__tests__/componentApi.test.js
```

### Task 4: Documentation And Local Artifact Cleanup

- [x] Remove unreferenced `F1SimulatorApp` pass-through methods for car renderer and readout formatter helpers after confirming they are absent from repo call sites and public declarations.
- [x] Update `docs/architecture.md` to mention `src/config/restartOptions.js` under config ownership.
- [x] Update stale vehicle ownership references in `docs/rules.md` and `docs/architecture.md` so the docs name canonical `src/simulation/vehicle/` modules instead of root compatibility re-export files.
- [x] Remove only ignored generated/local artifacts:

```bash
find . -path './node_modules' -prune -o -path './local-preview/node_modules' -prune -o -path './.git' -prune -o -type f \( -name '.DS_Store' -o -name '*.log' \) -print
find . -path './node_modules' -prune -o -path './local-preview/node_modules' -prune -o -path './.git' -prune -o -type d \( -name '.pytest_cache' -o -name 'dist' \) -print
```

- [x] Delete only the listed ignored artifacts after verifying they are not tracked.
  - Removed ignored, untracked `local-preview/dist/` and `.vite/`.
  - `.playwright-cli/` and `.playwright-mcp/` were gone by final status after browser verification cleanup.
  - `node_modules/`, `local-preview/node_modules/`, `.env`, and `local-preview/public/local-checkpoints/` were intentionally kept.

### Task 5: Verification And Completion Audit

- [x] Extract `BrowserExpertExternalRenderer.js` from `BrowserExpertAdapter.js` and verify browser expert behavior with:

```bash
npm test -- src/__tests__/browserExpert.test.js
```

- [x] Extract `observationVector.js` from `observations.js` and verify compact/full observation behavior with:

```bash
npm test -- src/__tests__/environment.test.js --testNamePattern "compact vector-only observations match full observations|supports compact vector-only observations|supports typed vector observations|batch-training full observations|physical driver observations stay finite"
npm test -- src/__tests__/environment.test.js
```

- [x] Extract track-query grid, pit, scratch, and stats helpers from `trackQueryIndex.js` and verify indexed track/environment behavior with:

```bash
npm test -- src/__tests__/trackModel.test.js src/__tests__/environment.test.js --testNamePattern "indexed|trackQueryIndex|batch-training rays|nearest-track|pit lane"
```

- [x] Run deeper simulation/environment/track regression tests after the track-query split:

```bash
npm test -- src/__tests__/trackModel.test.js src/__tests__/environment.test.js src/__tests__/raceSimulation.test.js
```

- [x] Run the normal package gate:

```bash
npm run check
```

- [x] Run the broader release gate because environment observation, browser expert, and simulator query infrastructure were touched:

```bash
npm run check:release
```

- [x] Inspect `git diff --stat` and `git diff --check`.
- [x] Log or update the non-trivial implementation work in Linear for the PaddockJS project, including the cleanup performed and verification result.
  - Initial cleanup logged as Linear issue `MGI-122`; update it with the deeper continuation before final handoff.
- [x] Final response must state changed files, verification command results, remaining risks, and whether the larger goal still has follow-up cleanup candidates.
