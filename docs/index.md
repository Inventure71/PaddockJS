# PaddockJS Documentation

PaddockJS is a browser-mounted, data-driven F1-style race simulator component. It is designed to live as its own package and be installed into host websites such as the portfolio site.

Use these docs as the package source of truth:

- [System Specs](system_specs.md): expected package behavior, public API, runtime guarantees, and verification standards.
- [Rules](rules.md): race-control behavior, DRS, safety car, starts, ordering, contact handling, and simulation rules.
- [Concepts](concepts.md): vocabulary used by the simulator.
- [Data Contract](data_contract.md): shape of host-provided drivers, car pairings, ratings, assets, and callbacks.
- [Architecture](architecture.md): module ownership and data/control flow.

When simulator behavior changes, update the relevant doc in this folder in the same change.
