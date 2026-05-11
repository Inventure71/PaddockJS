# PaddockJS Install and Update Guide

This guide explains how host websites consume the published PaddockJS npm package.

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
npm install @inventure71/paddockjs@0.2.0
npm run check
```

After updating, smoke-test the page that mounts the simulator. Browser behavior changes should be checked in the consuming host, because host CSS, container size, and route handling are outside the package.

## Package Release Workflow

The package repo owns its release process:

- `npm run check` runs fast runtime tests, public type verification, dry-pack verification, packed-consumer install/build verification, the tracked showcase build, and a quick Chromium browser smoke test.
- `npm run check:release` runs the exhaustive release gate, including slow characterization tests and the full Chromium browser smoke matrix.
- `npm run consumer:smoke` packs the package, installs the tarball into a fresh temporary Vite app, and builds that app through public package imports.
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

The release PR must include synchronized `package.json`, `package-lock.json`, `CHANGELOG.md`, and Changesets output for the version being published.

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
