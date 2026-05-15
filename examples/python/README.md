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

## Run

```bash
python examples/python/base_policy_server.py
```

Then in Policy Runner:

1. Select controller `Live node view`
2. Use `ws://127.0.0.1:8787/preview`
3. Connect

## Extend

Subclass `BasePolicyServer` and override:

- `init_policy(ctx)`
- `reset_policy(ctx)`
- `reset_policy_state(driver_ids)`
- `decide_batch(ctx)`
- `publish_preview_frame(frame)` (optional)

Use `broadcast_preview_frame(snapshot, observation, meta)` to push authoritative frames to the browser renderer.
