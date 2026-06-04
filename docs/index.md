# PaddockJS Documentation

PaddockJS is a browser-mounted, data-driven F1-style race simulator component. It is designed to live as its own package and be installed into host websites such as the portfolio site.

Code snippets in the documentation are illustrative host integration fragments unless a page says they are a complete runnable file. Public import paths are still authoritative.

Start with the consumer task docs:

- [Getting Started](getting-started.md): install, browser mount, package CSS, bundled assets, host responsibilities, and container sizing.
- [Composable Layouts](composable-layouts.md): building host layouts from package-owned simulator surfaces.
- [Headless Environment](headless-environment.md): browser-free environment imports, expert-mode boundary, and basic stepping.
- [Data Helpers](data-helpers.md): CSS-free data/tooling imports and procedural track helpers.
- [Theming](theming.md): mount-time theme, runtime theme sync, and public theme helpers.
- [Troubleshooting](troubleshooting.md): common host build, CSS, asset, expert-mode, and upgrade issues.
- [Upgrading Hosts to 4.x](upgrading-hosts-to-3.md): short checklist for moving a host website from 2.x-era usage to the 4.x package API.

Reference docs:

- [System Specs](system_specs.md): expected package behavior, public API, runtime guarantees, and verification standards.
- [Rules](rules.md): race-control behavior, DRS, safety car, starts, ordering, contact handling, and simulation rules.
- [Concepts](concepts.md): vocabulary used by the simulator.
- [Data Contract](data_contract.md): shape of host-provided drivers, car pairings, ratings, assets, and callbacks.
- [Bring Your Own Model](training.md): environment contract, policy convention, and visual playback loop.
- [Model Sense Contract](sense_contract.md): executable proof boundary for policy-facing observation senses.
- [Custom Model Controller Guide](custom_model_controller.md): how to wrap a trained model as a batched driver controller for browser playback or headless loops.
- [Architecture](architecture.md): module ownership and data/control flow.
- [Component Inventory](component_inventory.md): package-owned UI surfaces, shared bases, derived/mixed variants, and remaining intentional duplication.
- [Data Model Notes](data_model.md): lower-level simulator data model notes kept with package docs.
- [Learnings](learnings.md): implementation lessons and layout verification rules learned from simulator integration issues.

Common paths:

- Installing PaddockJS into a browser host: read [Getting Started](getting-started.md), then [Data Contract](data_contract.md) for full option shapes.
- Upgrading an existing browser host from 2.x-era usage: read [Upgrading Hosts to 4.x](upgrading-hosts-to-3.md), then [Troubleshooting](troubleshooting.md) if the host build fails.
- Building a package-owned composable layout: read [Composable Layouts](composable-layouts.md), then the sizing and UI options in [Data Contract](data_contract.md).
- Enabling pits, penalties, tire requirements, safety car, or stalled off-track DNF: read [Rules](rules.md) first. Pit stops require `rules.modules.pitStops.enabled`; `tireStrategy` alone only controls compounds, tire-requirement stewarding, and pit target choices.
- Connecting a trained model: read [Headless Environment](headless-environment.md), [Bring Your Own Model](training.md), then [Custom Model Controller Guide](custom_model_controller.md). PaddockJS owns observations, actions, specs, scenarios, and browser playback; the host owns the model, reward, storage, and training framework.
- Changing internals: read [Architecture](architecture.md) before editing source so new code lands in the feature-owned module instead of a facade or compatibility barrel.

When simulator behavior changes, update the relevant doc in this folder in the same change.
