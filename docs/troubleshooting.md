# Troubleshooting

Use this when a host integration or package release check fails.

## Raw Node Import Fails

Do not use this as the main package check:

```bash
node -e "import('@inventure71/paddockjs')"
```

The root package is browser-oriented and imports CSS/assets. Use the browser-free subpaths in Node:

```js
import { createPaddockEnvironment } from '@inventure71/paddockjs/environment';
import { DriverData } from '@inventure71/paddockjs/data';
```

## CSS Is Missing

Import the package stylesheet from a browser entry when the host bundler does not extract it automatically:

```js
import '@inventure71/paddockjs/styles.css';
```

If styles are present but the simulator is squeezed or overlapping, check the host container size before changing package internals. PaddockJS supports roots at least `320px` wide and shows an `Unsupported size` placeholder below supported bounds.

## Assets Do Not Resolve

PaddockJS owns default simulator assets. Hosts should not copy them manually. In the package repo, verify publish contents with:

```bash
npm run pack:dry
```

In a host app, verify through the host's browser build rather than a raw Node import.

## Simulator Looks Frozen

Check whether browser expert mode is enabled:

```js
expert: { enabled: true, controlledDrivers: ['budget'] }
```

Expert mode intentionally waits for `simulator.expert.step(actions)`. Basic website mounts should omit `expert` unless they are playing back a model or debugging policy observations.

## Theme Toggle Resets The Race

Use runtime theme APIs instead of restarting:

```js
simulator.setThemeMode('dark');
simulator.setTheme({ tokens: { primary: '#008c55' } });
```

`restart(nextOptions)` is for race/data/seed changes, not normal light/dark presentation sync.

## 3.x Upgrade Symptoms

- Remove host usage of `trackQueryIndex`; indexed track queries are package internals.
- Replace old strict physics usage with `physicsMode: 'advanced'`, or omit `physicsMode` for the default `arcade` mode.
- Use `@inventure71/paddockjs/environment` for headless simulation.
- Use `@inventure71/paddockjs/data` for CSS-free data/tooling imports.

See [Upgrading Hosts To PaddockJS 3.x](upgrading-hosts-to-3.md).
