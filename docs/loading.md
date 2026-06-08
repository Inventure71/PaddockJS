# Startup Loading

PaddockJS has two different startup loading surfaces. They solve different timing problems and should not be treated as interchangeable.

## The Two Phases

| Phase | When it can appear | Owner | Purpose |
| --- | --- | --- | --- |
| Pre-JS placeholder | Before the full PaddockJS browser bundle has downloaded, parsed, and imported | Host page, using the optional package placeholder helper/CSS | Give the user immediate lightweight visual feedback during the network/import gap |
| Package loading overlays | After `mountF1Simulator()` or a composable `mount*()` call starts | PaddockJS runtime | Cover PixiJS setup, asset loading, control binding, simulation creation, readout initialization, and the first real frame |

The pre-JS placeholder exists because PaddockJS cannot render anything before PaddockJS code exists on the page. The package loading overlays exist because, once the package has started, the runtime still needs time to build the simulator.

## Phase 1: Pre-JS Placeholder

Use the optional placeholder subpath when a host wants visible simulator UI before importing the full browser runtime:

```js
import { createPaddockLoadingPlaceholder } from '@inventure71/paddockjs/placeholder';
import '@inventure71/paddockjs/placeholder.css';

root.innerHTML = createPaddockLoadingPlaceholder({
  label: 'Loading simulator',
  detail: 'Preparing race control',
});
```

`@inventure71/paddockjs/placeholder` is intentionally separate from the root package. It does not import PixiJS, simulator assets, package runtime CSS, `F1SimulatorApp`, or the browser mount. The stylesheet at `@inventure71/paddockjs/placeholder.css` is a tiny standalone stylesheet for the default start-light placeholder.

The helper returns inert escaped HTML. It does not mount the simulator, register event listeners, fetch assets, or start any timers. The default `lights` variant uses CSS animation only.

## Bundled Browser Hosts

In Vite, Rollup, Webpack, or another browser bundler, render the placeholder first, then dynamically import the full simulator:

```js
import { createPaddockLoadingPlaceholder } from '@inventure71/paddockjs/placeholder';
import '@inventure71/paddockjs/placeholder.css';

const root = document.getElementById('f1-simulator-root');

root.innerHTML = createPaddockLoadingPlaceholder({
  label: 'Loading simulator',
});

const startSimulator = async () => {
  const { mountF1Simulator } = await import('@inventure71/paddockjs');
  await mountF1Simulator(root, { drivers, entries });
};

if ('requestIdleCallback' in window) {
  window.requestIdleCallback(startSimulator);
} else {
  setTimeout(startSimulator, 0);
}
```

The dynamic root import lets the page paint the placeholder before paying for the full browser simulator bundle. The full mount replaces the placeholder root content when PaddockJS starts.

## Static HTML Hosts

Plain static HTML pages cannot resolve bare npm imports such as `@inventure71/paddockjs/placeholder` directly in the browser unless the page also provides a bundler output or import map. Do not add a runtime bundling step only to render the placeholder.

For static hosts with a build script, run the helper at build time and inject the generated HTML into the static page:

```js
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { createPaddockLoadingPlaceholder } from '@inventure71/paddockjs/placeholder';

const require = createRequire(import.meta.url);

const placeholderHtml = createPaddockLoadingPlaceholder({
  label: 'Loading simulator',
  detail: 'Preparing race preview',
});

const cssSource = require.resolve('@inventure71/paddockjs/placeholder.css');
const cssTarget = 'dist/f1-simulator/paddock-placeholder.css';

mkdirSync(dirname(cssTarget), { recursive: true });
copyFileSync(cssSource, cssTarget);

const html = readFileSync('projects.html', 'utf8')
  .replace('<!-- paddock-placeholder -->', placeholderHtml)
  .replace(
    '</head>',
    '  <link rel="stylesheet" href="/f1-simulator/paddock-placeholder.css">\n</head>',
  );

writeFileSync('dist/projects.html', html);
```

That pattern keeps the first paint static and cheap while avoiding manual markup drift. The HTML still comes from the package helper, and the CSS still comes from the package stylesheet.

If a static host cannot run the helper during its build, copying the generated placeholder markup contract is acceptable as a fallback, but it is weaker. Manual markup can drift if the package changes the placeholder structure in a later release.

## Phase 2: Package Loading Overlays

After PaddockJS JavaScript starts, `mountF1Simulator(root, options)` synchronously writes a lightweight package shell into the mount root. The shell includes package-owned loading overlays for startup-capable surfaces such as the race canvas, controls, timing tower, race-data panel, telemetry stack, and composable component roots.

Composable hosts get the same behavior per mounted surface:

```js
const simulator = createPaddockSimulator(options);

simulator.mountRaceCanvas(canvasRoot);
simulator.mountTimingTower(timingRoot);
simulator.mountTelemetryPanel(telemetryRoot);

await simulator.start();
```

Each `mount*()` call writes static package markup and a surface-specific `data-paddock-loading` overlay immediately. `start()` removes those overlays only after PixiJS, assets, controls, initial DOM readouts, and the first frame have initialized.

These overlays are automatic. Hosts should not recreate them, query them for simulator state, or patch package internals to hide them. If a host needs a different pre-PaddockJS first paint, use the phase-1 placeholder around or inside the same root before calling the package mount.

## Replacement Flow

A typical lazy startup flow is:

1. Host HTML/CSS paints the page and optional pre-JS placeholder.
2. Host code imports the full PaddockJS browser bundle.
3. `mountF1Simulator()` or composable `mount*()` calls replace the placeholder with package startup markup.
4. PaddockJS shows package loading overlays while runtime setup finishes.
5. PaddockJS removes those overlays after the first real simulator frame is ready.

The pre-JS placeholder and package overlays can look similar, but they are intentionally separate. The first is a host-rendered shell for the network/import gap. The second is package runtime UI for simulator boot.

## What Not To Do

- Do not expect a plain static HTML page to resolve `@inventure71/paddockjs/placeholder` as a browser import without a bundler or import map.
- Do not eagerly import the root `@inventure71/paddockjs` package just to show a loading screen; that defeats the payload split.
- Do not copy simulator assets or PixiJS into the pre-JS placeholder.
- Do not manually maintain copied placeholder markup when the host has a build step that can call `createPaddockLoadingPlaceholder()`.
- Do not style package runtime internals such as `.start-lights`, `.timing-list`, or `.race-data-panel` from host CSS. Size the host root and let PaddockJS own runtime layout.

## Related Placeholders

PaddockJS also shows an `Unsupported size` placeholder when a shell or component is constrained below its supported bounds. That is not a startup loader. It is a layout safety state that tells the host to fix the container size rather than letting package controls overlap or clip.
