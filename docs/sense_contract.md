# Model Sense Contract

This document defines the proof boundary for model-facing PaddockJS senses. The
active environment observation contract is the source of truth for policies,
Policy Runner inputs, expert visualization, and rollout recording.

## What Is Proven In Code

`src/__tests__/environmentSenseContract.test.js` is the executable contract for
core model-facing senses. It checks three layers:

1. Object observations are compared against independent formulas from the
   returned simulator snapshot. This covers body telemetry, local track
   relation, race state, lookahead samples, wheel contact patches, nearby-car
   geometry, and opponent radar fields.
2. Vector observations are decoded by schema name and compared against the
   object observation oracle. A vector entry is not accepted unless a matching
   schema oracle exists.
3. Compact vector-only output is compared against full output for the same
   deterministic state, and public per-driver observation specs are compared
   against the schemas produced in observations.

This is intentionally stronger than testing current implementation against
itself: the object oracle uses simulator snapshot facts and unit conversions,
while the vector oracle uses schema names and object fields rather than calling
`buildObservationVector()`.

## Model-Facing Sense Rules

- Public distance fields with a `Meters` suffix are meters, not simulator
  units.
- Public angle fields with a `Radians` suffix are radians.
- Speed is exposed both as `speedKph` and `speedMetersPerSecond`; the latter is
  derived from the simulator speed unit conversion.
- `self.onTrack` and `trackRelation.onLegalSurface` follow wheel-level legal
  surface rules when wheel contact patches exist.
- `contactPatches` always uses the stable order `front-left`, `front-right`,
  `rear-left`, `rear-right`.
- `nearbyCars` are sorted by car-relative distance, with deterministic ordering
  for equal distances.
- Opponent radar fields use actual advanced-mode velocity vectors when present.
- Ray object values, vector values, schemas, and visualizations must describe
  the same active observation values. Debug-only precision may exist only when
  clearly labeled and must not be presented as model input.
- `getObservationSpec()` is the canonical schema for compact loops, including
  per-driver sensor overrides. Surface fields use canonical `kerb`, then
  `illegalSurface` order when enabled, regardless of configuration order.
  `environmentObservationSchema.test.js` covers this across full/compact,
  schema-free, array/Float32, and per-driver override paths.

## Remaining Formal Limits

The test suite proves conformance to the executable contract above for the
deterministic scenarios it enumerates. It is not a mathematical proof over every
possible JavaScript object a caller could construct or every physically possible
track state. Extending the proof boundary requires adding more oracle cases for
the specific state family, for example replay ghosts, pit-service movement, or a
new sensor channel.

Any new model-facing sense must add or extend an oracle in
`environmentSenseContract.test.js`. Adding a vector schema field without an
oracle must fail the test.
