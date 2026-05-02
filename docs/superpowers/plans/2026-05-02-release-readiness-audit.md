# 0.3.0 Release Readiness Audit Plan

**Goal:** Verify that the 0.3.0 package surface, docs, examples, preview site, and publish contents are coherent before doing release work.

**Scope:** This is an audit/checkpoint plan, not a feature plan. Do not add new API surface unless the audit finds a concrete release-blocking issue.

## 1. Public Surface Audit

Confirm the package exports exactly the intended public entry points:

```txt
@inventure71/paddockjs
@inventure71/paddockjs/environment
@inventure71/paddockjs/styles.css
```

Check:

- `package.json` `exports`
- `src/index.js`
- `src/index.d.ts`
- `src/environment/index.js`
- `src/environment/index.d.ts`

Questions:

- Are we exposing only browser simulator APIs from the root package?
- Is `createPaddockEnvironment()` only exposed from the environment subpath?
- Are expert APIs typed enough for browser policy playback?
- Are any training internals accidentally presented as an official ML framework?

## 2. Documentation Audit

Read these as a new user:

- `README.md`
- `docs/training.md`
- `docs/data_contract.md`
- `docs/system_specs.md`
- `docs/architecture.md`

Answer:

- How do I train externally?
- How do I plug a policy into the visual simulator?
- What observations do I receive?
- What actions do I return?
- What does PaddockJS explicitly not do?
- Are `createProgressReward()` and `examples/train-basic-policy.mjs` clearly optional starter examples?

Fix only unclear, stale, or overpromising wording.

## 3. Local Preview Browser Smoke

Run or reuse the local preview dev server:

```bash
npm --prefix local-preview run dev -- --port 5174
```

Smoke these pages:

```txt
/
/templates.html
/components.html
/api.html
/behavior.html
/expert-environment.html
/policy-runner.html
```

Check:

- navigation includes Expert and Policy Runner
- Expert page can reset/step in visual mode
- Expert page can reset/step in headless mode
- ray visualization appears in the actual canvas
- Policy Runner page resets and steps the visual simulator
- Policy Runner readout shows `action`, `actionSpec`, and `observationSpec`
- no obvious broken layout or blank canvas

## 4. Package Dry-Run Audit

Run:

```bash
npm run pack:dry
```

Confirm the package includes:

```txt
README.md
docs/*.md
docs/training.md
examples/train-basic-policy.mjs
src/environment/*
src/index.js
src/index.d.ts
assets/*
```

Confirm the package does not include:

```txt
local-preview
docs/superpowers
test artifacts
agent files
temporary browser smoke files
```

If unexpected files appear, fix `package.json` `files`.

## 5. Overimplementation Boundary Review

Explicitly decide whether to keep or remove:

- `createProgressReward()`
- `examples/train-basic-policy.mjs`
- `local-preview/policy-runner.html`

Current expected decision:

- keep `createProgressReward()` because it is one optional starter helper
- keep `examples/train-basic-policy.mjs` because it is dependency-free and lives in `examples`
- keep `policy-runner.html` because it demonstrates bring-your-own-policy playback, not training

Reject additions of:

- neural-network dependencies
- model save/load APIs
- model registries/checkpoints
- official trained drivers
- additional reward preset library
- Python/Gym bridge in this release slice

## 6. Verification Gate

Run:

```bash
npm_config_cache=/private/tmp/paddockjs-npm-cache npm run check
```

Expected:

- Vitest suite passes
- TypeScript declaration check passes
- `npm pack --dry-run` passes
- local preview CI/build passes

If browser behavior was touched during the audit, repeat browser smoke.

## 7. Release Decision

Only after the audit is clean, decide whether to start release work.

Release work is separate from this audit and may include:

```bash
npm run changeset
npm run version-packages
npm run check
```

Do not publish or version packages until the release path is explicitly approved.
