# Package Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Harden PaddockJS release confidence by testing packed-package consumption, adding real browser smoke checks, cleaning the public training example, and documenting the expert API roadmap.

**Architecture:** Keep package runtime behavior unchanged. Add verification code under `scripts/` and `smoke/`, move example-only training data beside the example, and update package/docs/CI wiring. Treat advanced expert features as a documented roadmap, not as a rushed implementation.

**Tech Stack:** Node.js ESM scripts, npm pack/install, Vite temp consumer build, Playwright browser automation, existing Vitest/type/check pipeline.

---

### Task 1: Packed Consumer Build Smoke

**Files:**
- Create: `scripts/consumer-package-smoke.mjs`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`

- [x] **Step 1: Write a script that fails before implementation**

Create `scripts/consumer-package-smoke.mjs` with a temp outside-consumer Vite app that installs a packed tarball and imports both `@inventure71/paddockjs` and `@inventure71/paddockjs/environment`.

- [x] **Step 2: Run the script**

Run: `node scripts/consumer-package-smoke.mjs`

Expected before the script exists: command fails with module/file not found.

- [x] **Step 3: Implement the consumer smoke**

The script must:
- run `npm pack --pack-destination <temp-artifacts>`
- create a fresh temp app under `tmp/consumer-smoke`
- write `package.json`, `index.html`, and `src/main.js`
- install the tarball plus Vite
- build the temp app
- clean/recreate only its own temp directories

- [x] **Step 4: Wire scripts and CI**

Add `consumer:smoke` to `package.json`, include it in `npm run check`, and add browser install/smoke steps in CI only after Playwright is added.

### Task 2: Browser Smoke Tests

**Files:**
- Create: `smoke/browser-smoke.mjs`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`

- [x] **Step 1: Write browser smoke assertions**

Use Playwright to launch Chromium against `local-preview` and verify:
- `/templates.html` renders a non-empty canvas on desktop and mobile widths
- important package panels have no horizontal overflow
- `/api.html` snapshot/action buttons respond
- `/policy-runner.html` step advances expert mode and readout includes action/spec data

- [x] **Step 2: Run browser smoke before wiring**

Run: `node smoke/browser-smoke.mjs`

Expected before dependencies/wiring are complete: fails because Playwright is unavailable or no server is running.

- [x] **Step 3: Implement self-contained server lifecycle**

The smoke script must build or use `local-preview`, start a local Vite preview server on an available port, drive Chromium, then shut the server down.

- [x] **Step 4: Wire npm and CI**

Add `browser:smoke` and include it in `npm run check`. CI must install Chromium before running `npm run check`.

### Task 3: Public Training Example Cleanup

**Files:**
- Create: `examples/trainingData.mjs`
- Modify: `examples/train-basic-policy.mjs`
- Modify: `README.md`
- Modify: `docs/training.md`
- Modify: `docs/data_contract.md`

- [x] **Step 1: Move example data out of internal src imports**

Create self-contained driver and entry data in `examples/trainingData.mjs`.

- [x] **Step 2: Update the training script**

Import example data from `./trainingData.mjs`, not from `../src/...`.

- [x] **Step 3: Verify the example**

Run: `node examples/train-basic-policy.mjs --eval-only --steps=20 --episodes=1`

Expected: exits 0 and prints JSON summary.

### Task 4: Expert API Roadmap Clarity

**Files:**
- Modify: `docs/training.md`
- Modify: `docs/data_contract.md`
- Modify: `docs/system_specs.md`
- Modify: `Q&A.md`

- [x] **Step 1: Document what is supported now**

Explicitly list first-slice supported environment features: controlled drivers, normalized actions, sensor observations, full state, rewards, action/observation specs, browser expert stepping.

- [x] **Step 2: Document what is deferred**

List deferred features with intended ownership: scenario placements/static obstacles, debug mutation API, assisted controls, Python Gymnasium bridge.

- [x] **Step 3: Avoid claiming unsupported features**

Make docs clear that the package is Gym-ready JavaScript, not a Python Gym package.

### Task 5: Final Verification

**Files:**
- All changed files.

- [x] **Step 1: Run targeted commands**

Run:
```bash
node scripts/consumer-package-smoke.mjs
node smoke/browser-smoke.mjs
node examples/train-basic-policy.mjs --eval-only --steps=20 --episodes=1
```

- [x] **Step 2: Run full package check**

Run:
```bash
npm run check
```

- [x] **Step 3: Review diff and update Linear**

Review `git diff --stat` and log the implementation, verification, and follow-ups in Linear.
