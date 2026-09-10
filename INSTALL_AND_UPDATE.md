# PaddockJS Install and Update Guide

This guide explains how host websites consume the published PaddockJS npm package. For the normal browser integration path, start with [Getting Started](docs/getting-started.md). For split package-owned surfaces, use [Composable Layouts](docs/composable-layouts.md).

## Install

Install the package from npm:

```bash
npm install @inventure71/paddockjs
```

The host website imports PaddockJS by package name:

```js
import { mountF1Simulator } from '@inventure71/paddockjs';
```

Host applications should not copy simulator assets into their own source tree. PaddockJS owns its bundled car, safety-car, logo, panel, and track texture assets.

## Host Website Setup

Create a host entry file in the consuming website:

```js
import {
  CHAMPIONSHIP_ENTRY_BLUEPRINTS,
  DEMO_PROJECT_DRIVERS,
  mountF1Simulator,
} from '@inventure71/paddockjs';

const root = document.getElementById('f1-simulator-root');

if (root) {
  await mountF1Simulator(root, {
    drivers: DEMO_PROJECT_DRIVERS,
    entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
    title: 'F1 Simulator Lab',
    kicker: 'Race Control',
    backLinkHref: '/projects',
    backLinkLabel: 'Projects',
    onDriverOpen(driver) {
      if (driver.link) window.location.href = driver.link;
    },
  });
}
```

The host page needs a root element and the bundled JavaScript/CSS produced by the host build:

```html
<div id="f1-simulator-root"></div>
<script type="module" src="/dist/f1-simulator.js"></script>
```

If the host bundler does not extract package CSS automatically, import the stylesheet explicitly:

```js
import '@inventure71/paddockjs/styles.css';
```

Package CSS is scoped to PaddockJS mount roots/components and does not load remote fonts. Hosts that want custom brand typography should load those fonts in the host app and customize PaddockJS through the public theme/CSS-variable contract.

## Build Setup

Use a browser bundler that understands JavaScript module imports, CSS imports, and image imports. Vite, Rollup, Webpack, and similar bundlers are valid fits.

Use Node `20.19.0` or newer for local package development, showcase builds, and host builds based on the current Vite toolchain.

Example Vite entry config:

```js
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: 'src/paddockjs-entry.js',
      output: {
        entryFileNames: 'f1-simulator.js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
```

Run the host's normal install and build checks:

```bash
npm install
npm run check
```

Do not use raw Node as the main import test:

```bash
node -e "import('@inventure71/paddockjs')"
```

That can fail because PaddockJS imports CSS and image assets. Verify through a browser-oriented host build instead.

## Updating The Package

Install the latest published version:

```bash
npm install @inventure71/paddockjs@latest
npm run check
```

Install a specific version when the host needs a controlled upgrade:

```bash
npm install @inventure71/paddockjs@4.2.0
npm run check
```

After updating, smoke-test the page that mounts the simulator. Browser behavior changes should be checked in the consuming host, because host CSS, container size, and route handling are outside the package.

### 4.2.0 Migration Notes

- No breaking host migration is required from `4.1.0`.
- Browser mounts, composable mounts, `@inventure71/paddockjs/environment`, `@inventure71/paddockjs/data`, and `@inventure71/paddockjs/placeholder` keep their documented public import contracts.
- Do not rely on repository-local JavaScript trainer scripts or preview-only policy helper names as package API. Local model experiments belong outside the package surface; production integrations should use the documented environment API, custom model controller guide, or Python policy-server bridge.

### 4.1.0 Migration Notes

- No breaking host migration is required from `4.0.0`.
- Hosts that want visible simulator startup UI before the full PaddockJS browser bundle downloads can render the new `@inventure71/paddockjs/placeholder` HTML helper with the optional `@inventure71/paddockjs/placeholder.css` stylesheet. This placeholder subpath is intentionally independent of PixiJS, simulator assets, root runtime CSS, and the browser mount. Static HTML hosts should generate the placeholder HTML during their build and copy the CSS into their static output; see [Startup Loading](docs/loading.md).
- Existing `mountF1Simulator()` and composable `mount*()` integrations keep their normal automatic package loading overlays after PaddockJS JavaScript starts.

### 4.0.0 Migration Notes

- Update Policy Runner HTTP servers for protocol version `2`. Cache `actionSpec`, `observationSpec`, configuration, `previousActionFields`, and `metricFields` from `/policy/reset`, then read model inputs from `body.driverIds[index]` plus aligned `body.vectors[index]`, `body.previousActions[index]`, and `body.metrics[index]` in `/policy/decide-batch`. Rich observation objects, schemas, snapshots, and track metadata are no longer sent on every policy-server decision.
- Browser mounts, composable simulator APIs, headless environment imports, and data helper imports keep the `3.0.0` public API shape unless they depend on Policy Runner HTTP server payloads.

### 3.0.0 Migration Notes

- Remove any `trackQueryIndex` host option. Indexed track queries are always canonical package internals in 3.0.0.
- Rename strict vehicle-physics usage from `physicsMode: 'simulator'` to `physicsMode: 'advanced'`. The old string is no longer accepted and will resolve to the default `physicsMode: 'arcade'`.
- Prefer the semantic `theme` contract for new customization. Partial themes are valid, resolved themes are complete, and one-sided light/dark token overrides generate and cache the opposite mode. Legacy aliases such as `accentColor`, `greenColor`, and `yellowColor` remain migration aliases.
- Use `ui.driverCamera: true` to show the generated Driver camera button, or `initialCameraMode: 'driver'` to start in that mode.
- Use `@inventure71/paddockjs/environment` for browser-free simulation/training imports.
- Use `@inventure71/paddockjs/data` for CSS-free data/helper imports such as `DriverData`, `normalizeSimulatorDrivers`, `createProceduralTrack`, and speed conversion helpers.
- `backLinkHref` is sanitized; relative URLs, hash URLs, and absolute `http:` / `https:` URLs are accepted, while unsafe schemes fall back to the package default.
- Full public snapshots include `car.trackState` for the stable car-center track classification shape.
- Rebuild the host bundle and browser-smoke the host page, including theme toggles, selected-driver surfaces, and any composable mount roots. See [Troubleshooting](docs/troubleshooting.md) if the host build fails after the upgrade.

## Package Release Workflow

The package repo owns its release process:

- `npm run docs:check` validates documentation links and consumer-guidance guardrails.
- `npm run check` runs docs checks, fast runtime tests, public type verification, dry-pack verification, packed-consumer install/build verification, the tracked showcase and product-demo builds, the quick Chromium engineering-showcase smoke, and the complete product-demo smoke.
- `npm run check:release` starts with high-severity dependency audits for the package and both browser consumers, then runs the exhaustive release gate, including slow characterization tests, the full Chromium engineering-showcase matrix, and the complete product-demo smoke.
- `npm run audit:release` runs the three high-severity dependency audits without the rest of the release gate.
- `npm run consumer:smoke` packs the package, installs the tarball into a fresh temporary Vite app, and builds that app through public package imports.
- `npm run consumer:bundle-boundaries` packs the package, installs the tarball into a fresh temporary Vite app, and verifies the root browser import remains the CSS/asset-owning simulator bundle while `/placeholder`, `/data`, and `/environment` stay CSS-free or lightweight according to their documented roles.
- `npm run browser:smoke` builds `local-preview`, starts a local preview server, and checks desktop/mobile canvas rendering, overflow constraints, API buttons, and visual policy-runner stepping in Chromium. Use `npm run browser:smoke:quick` for the smaller local browser pass and `npm run browser:smoke:full` for the full matrix.
- `npm run changeset` records the next version bump and changelog note.
- `npm run version-packages` applies pending Changesets locally.
- `.github/workflows/ci.yml` verifies the package on push and pull request.
- `.github/workflows/release.yml` opens a release PR from Changesets and publishes to npm after merge through npm trusted publishing.

For trusted publishing on npm, configure the package settings to trust:

- organization or user: `Inventure71`
- repository: `PaddockJS`
- workflow filename: `release.yml`

No long-lived `NPM_TOKEN` secret is required once trusted publishing is enabled.

The release PR must include synchronized `package.json`, `package-lock.json`, `CHANGELOG.md`, and Changesets output for the version being published. Check `npm ci` behavior from a clean checkout or temporary worktree before handoff; a warm local `node_modules` tree can hide missing optional transitive lockfile entries.

## When Something Breaks

If the host cannot resolve the package, reinstall from npm:

```bash
npm install @inventure71/paddockjs@latest
```

If the host bundler cannot resolve an asset, verify the package contents from the package repo:

```bash
npm run pack:dry
```

Check that the asset is listed in the dry-pack output.

If simulator tests fail after a package change:

```bash
npm test
```

Fix the package first, then update and rebuild the host.
