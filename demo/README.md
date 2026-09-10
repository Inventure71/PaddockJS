# PaddockJS Demo

This is the new product-facing PaddockJS demo website. It is intentionally independent from `local-preview/`, which remains the existing development and characterization showcase.

```bash
npm install
npm run dev
```

Run the local gate with:

```bash
npm run check
```

`coverage:check` compares the demo feature catalog with the package's public controller, data, environment, and placeholder declarations. A public API addition must be classified in `src/data/featureCatalog.js` before the demo gate passes.

## Physics modes

The live race, composable examples, all layout presets, and headless demo use `arcade`, matching the package default. The existing `#expert` chapter is labeled **Advanced physics** and launches its keyboard/sensor lab only on request with an explicit `physicsMode: 'advanced'` override. Existing chapter links remain valid.

The advanced lab uses the rebuilt planar Formula-style force model and advanced AI. It is an experimental handling approximation, not a calibrated real car. Human keyboard commands ramp in simulated time before steering lock is scaled by speed, so short taps stay progressive. Keyboard traction assistance reduces throttle when the active observation reports overloaded tires; steering remains fully manual. The lab schedules at most 60 fixed steps per second on high-refresh displays and drops catch-up work after stalls. Policy actions stay unchanged. Click the visible race to drive. Focus loss, blur, hidden/offscreen state and disposal clear held keys and the keyboard's pending pit request. See `docs/advanced_physics_rebuild.md` for physical scope and validation, and [keyboard driving measurements](../docs/keyboard_driving_fix.md) for the control fixes.

`src/__tests__/demoPhysics.test.js` guards the package/demo defaults and explicit advanced opt-in. Its release-only field cases use the six actual demo seeds, normalized entries, standing starts and race rules for 180 simulated seconds, guarding against the mass off-track retirements missed by short UI smoke.
