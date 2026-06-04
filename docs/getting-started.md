# Getting Started

Use this guide when installing PaddockJS into a normal browser host website.

## Install

```bash
npm install @inventure71/paddockjs
```

PaddockJS is a browser component package. A host page gives it a root element, project/driver data, and optional routing callbacks. PaddockJS owns the simulator shell, PixiJS renderer, CSS, default assets, race controls, timing tower, telemetry surfaces, and simulation runtime.

## Mount The Simulator

```html
<div id="f1-simulator-root"></div>
```

```js
import { mountF1Simulator } from '@inventure71/paddockjs';

const root = document.getElementById('f1-simulator-root');

if (root) {
  await mountF1Simulator(root, {
    drivers,
    entries,
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

Use the root package only for browser mounts and browser helper exports. It imports package CSS and bundled simulator assets.

## CSS

Most browser bundlers consume the root package stylesheet automatically. If your host build does not, import the stylesheet explicitly from a browser entry:

```js
import '@inventure71/paddockjs/styles.css';
```

Package CSS is scoped to PaddockJS mount roots/components. It uses system font stacks and does not load Google Fonts or any remote font. Hosts that want branded typography should load fonts in the host app.

Do not target package internals such as `.sim-grid`, `.timing-list`, `.race-data-panel`, `.camera-controls`, or `.start-lights` from host CSS. Size the mount root; let PaddockJS own internal layout.

## Assets

Hosts should not copy simulator assets into their own source tree. PaddockJS ships its default car, safety-car, logo, panel, and track texture assets. Browser bundlers such as Vite, Rollup, and Webpack bundle those assets from the package.

## Container Sizing

PaddockJS supports mount roots at least `320px` wide. Use normal responsive host CSS:

```css
.simulator-section {
  width: 100%;
  min-width: 0;
}
```

If a package surface is constrained below its supported size, PaddockJS shows an `Unsupported size` placeholder rather than clipping controls or overlapping race UI.

## Where To Go Next

- Use [Composable Layouts](composable-layouts.md) when the host needs separate package-owned surfaces.
- Use [Theming](theming.md) for runtime light/dark sync and token customization.
- Use [Data Contract](data_contract.md) for full driver, entry, rule, UI, callback, and asset option shapes.
- Use [Troubleshooting](troubleshooting.md) when a host build or browser smoke fails.
