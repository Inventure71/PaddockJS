# PaddockJS

PaddockJS is an installable browser component package for an F1-style project race simulator. It owns the simulator UI, PixiJS runtime, bundled simulator assets, CSS, demo data, and public mount APIs. Host websites provide data, page placement, routing, and optional theme choices.

Code snippets in this README are illustrative host integration fragments unless a section says they are a complete runnable file.

## Install

```bash
npm install @inventure71/paddockjs
```

Use Node `20.19.0` or newer for local package development and modern Vite-based host builds.

## Browser Mount

For a normal website page, mount the all-in-one simulator from the root browser package:

```js
import { mountF1Simulator } from '@inventure71/paddockjs';

const root = document.getElementById('sim-root');

if (root) {
  await mountF1Simulator(root, {
    drivers: [
      {
        id: 'budget',
        name: 'Budget Buddy',
        color: '#ff2d55',
        link: '/projects/budget-buddy',
        raceData: ['AI finance coach', 'Python + LLM', 'Budget guardrails'],
      },
    ],
    entries: [
      {
        driverId: 'budget',
        driverNumber: 71,
        timingName: 'Budget',
      },
    ],
    onDriverOpen(driver) {
      if (driver.link) window.location.href = driver.link;
    },
  });
}
```

The root package is browser-oriented and imports package CSS. If your host build does not extract CSS from JavaScript imports, import the stylesheet explicitly:

```js
import '@inventure71/paddockjs/styles.css';
```

PaddockJS CSS is scoped under package mount/component roots and uses system font stacks. The package does not load Google Fonts or any other remote font. Hosts that want branded typography should load fonts in the host app.

## Startup Loading

`mountF1Simulator(root, options)` writes a lightweight package-owned HTML shell into `root` before it awaits PixiJS setup, asset loading, control binding, simulation creation, and the first canvas frame. That shell includes package loading overlays for the race controls, timing tower, race canvas, race-data panel, telemetry stack, and any other startup-capable package surface in the selected template. The overlays are removed only after the runtime has initialized and the initial readouts/frame are ready.

Composable hosts get the same behavior per mounted root: every public `simulator.mount*()` surface renders static package markup plus its own loading overlay before `await simulator.start()`.

This is a client-side startup shell, not server rendering. If a host wants visible content before the PaddockJS JavaScript bundle has downloaded and executed, use the tiny placeholder subpath and CSS:

```js
import { createPaddockLoadingPlaceholder } from '@inventure71/paddockjs/placeholder';
import '@inventure71/paddockjs/placeholder.css';

root.innerHTML = createPaddockLoadingPlaceholder({
  label: 'Loading simulator',
});

const loadSimulator = async () => {
  const { mountF1Simulator } = await import('@inventure71/paddockjs');
  await mountF1Simulator(root, { drivers, entries });
};

if ('requestIdleCallback' in window) {
  window.requestIdleCallback(loadSimulator);
} else {
  setTimeout(loadSimulator, 0);
}
```

`@inventure71/paddockjs/placeholder` does not import PixiJS, simulator assets, package runtime CSS, or the root browser mount. It is intended for the pre-JS/network gap. The full simulator mount replaces that placeholder and then uses the built-in package overlays while PixiJS and the race runtime finish booting. Static HTML hosts should run the placeholder helper in their build step and copy `@inventure71/paddockjs/placeholder.css` into their static output instead of expecting a plain browser page to resolve bare npm imports.

Start here:

- [Getting Started](docs/getting-started.md): install, browser mount, CSS, assets, host responsibilities, and container sizing.
- [Startup Loading](docs/loading.md): pre-JS placeholders, package loading overlays, and static-host build-time integration.
- [Data Contract](docs/data_contract.md): driver, entry, callback, rules, and option shapes.
- [Troubleshooting](docs/troubleshooting.md): common integration failures and supported checks.

## Composable Layouts

Use `createPaddockSimulator()` when a host wants to place package-owned surfaces in separate roots while keeping one simulator controller:

```js
import { createPaddockSimulator } from '@inventure71/paddockjs';

const simulator = createPaddockSimulator({ drivers, entries });

simulator.mountRaceControls(document.getElementById('sim-controls'));
simulator.mountRaceCanvas(document.getElementById('sim-race'), {
  includeTimingTower: true,
  includeRaceDataPanel: true,
});
simulator.mountRaceDataPanel(document.getElementById('sim-race-data'));

await simulator.start();
```

The controller methods are the canonical composable API. See [Composable Layouts](docs/composable-layouts.md) for the available surfaces, lifecycle, restart behavior, and sizing contract.

## Headless And Data Subpaths

Do not import the root package from raw Node or headless training code. The root package is for browser mounts and imports CSS/assets.

Use the browser-free environment subpath for simulation/training loops:

```js
import { createPaddockEnvironment } from '@inventure71/paddockjs/environment';
```

Use the CSS-free data subpath for tooling, server-side data normalization, and procedural track helpers:

```js
import { DriverData, normalizeSimulatorDrivers } from '@inventure71/paddockjs/data';
```

Read [Headless Environment](docs/headless-environment.md), [Data Helpers](docs/data-helpers.md), and [Bring Your Own Model](docs/training.md) for those paths.

## Runtime Theming

Use mount-time `theme` for defaults and controller methods for runtime site theme toggles:

```js
const simulator = await mountF1Simulator(root, { drivers, entries });

simulator.setThemeMode(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');

const stopThemeSync = simulator.syncThemeFrom(document.documentElement, {
  attribute: 'data-theme',
  map: { light: 'light', dark: 'dark' },
});
```

Do not restart the simulator only to change presentation. Runtime theme APIs keep race state, selected driver, penalties, speed, camera state, and pit intent state. See [Theming](docs/theming.md).

## Upgrade From 2.x

If a host is moving from 2.x-era usage, use [Upgrading Hosts To PaddockJS 4.x](docs/upgrading-hosts-to-3.md). The short version:

- install `@inventure71/paddockjs@4`
- remove `trackQueryIndex`
- replace `physicsMode: 'simulator'` with `physicsMode: 'advanced'` or omit it for `arcade`
- import package CSS intentionally for browser mounts
- use `/environment` for headless simulation and `/data` for CSS-free helpers
- rebuild and browser-smoke the host page

## Reference Docs

Normal consumers should start with the task docs above. These reference docs are the deeper package source of truth:

- [System Specs](docs/system_specs.md): public API, runtime guarantees, and verification standards.
- [Rules](docs/rules.md): race-control behavior, DRS, safety car, starts, ordering, contact handling, pits, penalties, and simulation rules.
- [Concepts](docs/concepts.md): simulator vocabulary.
- [Architecture](docs/architecture.md): module ownership and data/control flow for package contributors.
- [Component Inventory](docs/component_inventory.md): package-owned UI surfaces and template ownership.

## Package Workflow

Useful local commands:

```bash
npm run docs:check
npm run check
npm run check:release
npm run consumer:smoke
npm run browser:smoke:quick -- --skip-build
npm run showcase:dev
```

`npm run check` is the normal local gate: docs checks, fast runtime tests, public declarations, dry package contents, packed-package consumption in a fresh Vite app, the showcase build, and a quick Chromium smoke against the showcase. `npm run check:release` adds slow characterization tests and the full browser smoke matrix.

## License

PaddockJS is released under `Apache-2.0`. See [LICENSE](LICENSE).
