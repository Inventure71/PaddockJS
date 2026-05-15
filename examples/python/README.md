# Python Base Policy Server Example

This folder provides a neutral extension point for browser Policy Runner integrations.

It is not a trainer and not a model/checkpoint format owner. It only shows transport contracts:

- HTTP inference stubs
  - `POST /policy/reset`
  - `POST /policy/reset-state`
  - `POST /policy/decide-batch`
- Preview WebSocket stream
  - `ws://127.0.0.1:8787/preview`
  - packet shape: `{ type: "preview:snapshot", snapshot, observation, meta }`
- Preview latest-frame HTTP endpoint (for polling visualizers)
  - `http://127.0.0.1:8787/preview/frame`

## Run

```bash
python examples/python/base_policy_server.py
```

Then in Policy Runner:

1. Select controller `Live node view`
2. Use either:
   - `ws://127.0.0.1:8787/preview` (WebSocket push)
   - `http://127.0.0.1:8787/preview/frame` (HTTP polling)
3. Connect

Direct launch URL example (when local preview runs on `5174`):

`http://127.0.0.1:5174/policy-runner.html?controller=live-node-view&liveUrl=ws://127.0.0.1:8787/preview`

## Extend

Subclass `BasePolicyServer` and override:

- `init_policy(ctx)`
- `reset_policy(ctx)`
- `reset_policy_state(driver_ids)`
- `decide_batch(ctx)`
- `publish_preview_frame(frame)` (optional)

Use `broadcast_preview_frame(snapshot, observation, meta)` to push authoritative frames to the browser renderer.

## Important Boundary

- This server does not step the simulator by itself.
- Your training/runtime bridge (Python orchestration + JS environment) must provide authoritative frames by calling `broadcast_preview_frame(...)` after environment `reset/step/resetDrivers`.
- In browser `Live node view`, the simulator is render-only while attached; local browser stepping controls are intentionally disabled.
