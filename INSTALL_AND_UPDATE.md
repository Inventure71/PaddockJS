# PaddockJS Install and Update Guide

This guide explains how to use PaddockJS from another website, using the portfolio site as the main example.

## Easy Version

PaddockJS is the simulator package. The website is just the host.

The host website should:

1. Install PaddockJS.
2. Create one small JavaScript file that imports `mountF1Simulator`.
3. Pass drivers, car pairings, and `onDriverOpen(driver)`.
4. Run its normal build command.

For local development from a nearby folder:

```bash
cd /Users/inventure71/VSProjects/Inventure71.github.io
npm install ../PaddockJS
npm run check
```

After changing PaddockJS code:

```bash
cd /Users/inventure71/VSProjects/PaddockJS
npm run check

cd /Users/inventure71/VSProjects/Inventure71.github.io
npm install ../PaddockJS
npm run check
```

If the website uses Vite, edits inside `../PaddockJS` are usually picked up quickly because npm installs it as a local symlink. Run `npm install ../PaddockJS` again when you change package metadata, dependencies, exports, or assets.

## What Gets Installed

The package name is:

```txt
@inventure71/paddockjs
```

The install command for a local sibling folder is:

```bash
npm install ../PaddockJS
```

That writes this dependency into the host website's `package.json`:

```json
{
  "dependencies": {
    "@inventure71/paddockjs": "file:../PaddockJS"
  }
}
```

It also creates a symlink in the host website:

```txt
node_modules/@inventure71/paddockjs -> ../../../PaddockJS
```

That means the website imports PaddockJS like a real package:

```js
import { mountF1Simulator } from '@inventure71/paddockjs';
```

## Host Website Setup

Create a small host entry file in the website. In the portfolio repo this is `js/paddockjs-portfolio.js`.

```js
import {
  CHAMPIONSHIP_ENTRY_BLUEPRINTS,
  DEMO_PROJECT_DRIVERS,
  mountF1Simulator,
} from '@inventure71/paddockjs';

const root = document.getElementById('f1-simulator-root');

if (root) {
  mountF1Simulator(root, {
    drivers: DEMO_PROJECT_DRIVERS,
    entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
    title: 'F1 Simulator Lab',
    kicker: 'Race Control',
    backLinkHref: 'projects.html',
    backLinkLabel: 'Projects',
    onDriverOpen(driver) {
      if (driver.link) window.location.href = driver.link;
    },
  });
}
```

The HTML page only needs a root element and the built script/CSS:

```html
<div id="f1-simulator-root"></div>
<link rel="stylesheet" href="dist/f1-simulator/f1-simulator.css">
<script type="module" src="dist/f1-simulator/f1-simulator.js"></script>
```

The host website should not copy PaddockJS assets into its own source tree. PaddockJS owns its bundled assets.

## Build Setup

The host website needs a bundler that understands JavaScript module imports, CSS imports, and image imports. The current portfolio uses Vite.

Example Vite entry config:

```js
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist/f1-simulator',
    rollupOptions: {
      input: 'js/paddockjs-portfolio.js',
      output: {
        entryFileNames: 'f1-simulator.js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.css')) {
            return 'f1-simulator.css';
          }
          return 'assets/[name][extname]';
        },
      },
    },
  },
});
```

Run the host build:

```bash
npm run build:f1
```

For the portfolio, the full verification command is:

```bash
npm run check
```

## Keeping PaddockJS Up To Date Locally

Use this after changing PaddockJS code:

```bash
cd /Users/inventure71/VSProjects/PaddockJS
npm run check
```

Then rebuild the host:

```bash
cd /Users/inventure71/VSProjects/Inventure71.github.io
npm run check
```

Run `npm install ../PaddockJS` again when:

- `PaddockJS/package.json` changes.
- dependencies change.
- exports change.
- assets are added, removed, or renamed.
- the host cannot resolve the package.

For normal source edits inside `src/*.js`, Vite usually sees the symlinked package immediately, but a fresh install is cheap and removes doubt.

## Verifying The Local Install

From the host website:

```bash
cd /Users/inventure71/VSProjects/Inventure71.github.io
npm install ../PaddockJS
readlink node_modules/@inventure71/paddockjs
npm run check
```

Expected `readlink` result:

```txt
../../../PaddockJS
```

Expected check result:

```txt
Test Files  7 passed
Tests       54 passed
build:f1    succeeds
```

Do not use raw Node as the main import test:

```bash
node -e "import('@inventure71/paddockjs')"
```

That can fail because PaddockJS imports CSS and image assets. This is normal for a Vite/browser component. Verify through the host website build instead.

## Publishing Later

Local install is best while developing. When PaddockJS is stable, publish it to npm or GitHub Packages.

Before publishing:

```bash
cd /Users/inventure71/VSProjects/PaddockJS
npm run check
npm version patch
```

For public npm:

```bash
npm publish --access public
```

Then the host can install it without a local path:

```bash
cd /Users/inventure71/VSProjects/Inventure71.github.io
npm install @inventure71/paddockjs@latest
npm run check
```

Updating later becomes:

```bash
npm update @inventure71/paddockjs
npm run check
```

## When Something Breaks

If the host cannot import the package:

```bash
cd /Users/inventure71/VSProjects/Inventure71.github.io
npm install ../PaddockJS
```

If Vite cannot resolve an asset:

```bash
cd /Users/inventure71/VSProjects/PaddockJS
npm run pack:dry
```

Check that the asset is listed in the package contents.

If tests fail after a simulator change:

```bash
cd /Users/inventure71/VSProjects/PaddockJS
npm test
```

Fix the package first, then rebuild the host.
