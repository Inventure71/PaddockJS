# PaddockJS Website

One website contains the live Demo, integration Guide, engineering Labs and package Reference. It is a private repository host, excluded from the published npm package.

From the repository root:

```bash
npm run site:install
npm run site:dev
```

Open the URL printed by Vite, normally `http://127.0.0.1:5173/`. All sections use that same origin and server. Missing pages return HTTP 404 rather than silently falling back to the demo:

| Section | URL | Content |
| --- | --- | --- |
| Demo | `/` | Live Grid Walk/Race, public components, presets, controller actions, advanced keyboard lab, headless example and searchable capabilities |
| Guide | `/guide/` | Templates, components, customization, public API, Grid Walk and rules |
| Labs | `/labs/` | Playable expert controls, behavior fixtures, stewarding, collision diagnostics and Policy Runner |
| Reference | `/reference/` | Readable pages generated from the repository Markdown documentation |

The shared navigation links these sections. Old showcase links such as `/grid-walk.html`, `/templates.html` and `/policy-runner.html` redirect to their canonical routes while preserving query parameters and fragments. Existing `demo:*` and `showcase:*` root commands remain aliases for the same website commands.

## Ownership

- `src/demo/` owns product-tour runtime integration, page interactions and its feature catalogue.
- `src/showcase/` owns focused Guide/Labs examples and deterministic fixtures.
- Shared shell/navigation and the route inventory connect the website sections.
- `build/` owns source-document generation, HTML composition and local-checkpoint discovery. Model JSON stays in optional public exports rather than the JavaScript bundle.
- `public/` owns website-only assets. Optional exported policy files belong in ignored `public/local-checkpoints/`; they are local inputs, not package assets.
- `scripts/check-feature-coverage.mjs` compares the feature catalogue with package declarations. New public controller, environment, data and placeholder exports must be classified before the website gate passes.

The site installs PaddockJS with `"@inventure71/paddockjs": "file:.."`. Ordinary examples import public package entrypoints. The labeled collision and Policy Runner diagnostics also import private geometry/query and presentation-metric modules; those private modules are not supported host integration APIs.

## Grid Walk and physics

The main demo starts with Grid Walk enabled. Select a car, use its project banner, then select Race. Returning to Grid Walk pauses the existing race and displays original grid poses; Race resumes the saved session. The dedicated `/guide/grid-walk.html` example also exposes real container-size controls for camera behavior.

Ordinary races, presets and the headless example use `arcade`, the package default. The Advanced physics chapter lazily starts an explicit `physicsMode: 'advanced'` keyboard lab. It is an experimental planar handling approximation, not a calibrated real car. Keyboard commands ramp in simulated time, throttle assistance uses active model observations, and focus/visibility loss clears held input. See [physics scope](../docs/advanced_physics_rebuild.md) and [keyboard behavior](../docs/keyboard_driving_fix.md).

## Policy Runner

Open `/labs/policy-runner.html` for distilled checkpoint policies, an external policy server or a live preview stream. Optional local checkpoints remain available under `/local-checkpoints/`. Put `latest-distilled-policy.json` or `latest-hybrid-policy.json` in `public/local-checkpoints/` before starting or building the site. The page discovers existing exports; a clean checkout uses its idle controller without requesting missing models. Rebuild a static site after adding exports.

For the supplied HTTP policy example:

```bash
python -m pip install -r examples/python/requirements.txt
python examples/python/base_policy_server.py
```

Select **Policy server** and enter its URL. The browser owns simulation stepping. Protocol version `2` sends static specs/configuration once on reset and aligned compact vectors, prior actions, metrics and events per decision. The visual sense panel consumes the same active observation contract; it does not derive more precise model senses. Diagnostic JSON is throttled during automatic playback.

## Verification

```bash
npm run site:build
npm run check
npm run check:release
```

`site:build` validates public-feature coverage, builds `site/dist/`, and checks built document destinations. Reference pages are generated from `docs/*.md`, the install guide and the Python controller guide. Missing document classifications, output collisions and broken built links/fragments fail the website build. Unchanged generated pages retain their modification times, so rebuilding does not reload an active browsing session. `PADDOCK_SITE_BASE=/PaddockJS/` builds for a hosted subdirectory. `site:ci` performs one clean website install and this same build. The package gates build the website once, then both browser suites reuse it:

```bash
npm run browser:smoke:full -- --skip-build
npm run demo:smoke -- --skip-build
```

The Guide/Labs matrix retains desktop, tablet, mobile, minimum-width and short-wide fixtures, API/lifecycle controls, Policy Runner and Grid Walk checks. The product suite exercises real package surfaces, presets, headless and keyboard controls, discovery/navigation and narrow layouts. Packed-consumer checks independently prove the published package boundary. The Vite optimization cache stays outside `site/node_modules`, so clean installs do not invalidate an active server's cached dependency URLs.
