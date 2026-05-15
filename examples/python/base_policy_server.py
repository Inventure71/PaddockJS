#!/usr/bin/env python3
"""Neutral PaddockJS policy server base example.

This file is intentionally minimal and transport-focused:
- HTTP policy endpoints:
  - POST /policy/reset
  - POST /policy/reset-state
  - POST /policy/decide-batch
- WebSocket preview endpoint:
  - /preview (broadcasts {snapshot, observation, meta})

Extend `BasePolicyServer` and override hook methods to plug your own model/runtime.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Mapping, MutableMapping, Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
import uvicorn


def _zero_action() -> Dict[str, float]:
    return {
        "steering": 0.0,
        "throttle": 0.0,
        "brake": 0.0,
    }


@dataclass
class ServerState:
    session_id: int = 0
    controlled_drivers: List[str] = field(default_factory=list)
    connections: List[WebSocket] = field(default_factory=list)


class BasePolicyServer:
    """Base extension surface for custom policy/runtime integrations."""

    def __init__(self) -> None:
        self.app = FastAPI(title="PaddockJS Base Policy Server")
        self.state = ServerState()
        self._broadcast_lock = asyncio.Lock()
        self._register_routes()

    # ----- Extension hooks -------------------------------------------------

    async def init_policy(self, context: Mapping[str, Any]) -> None:
        """Initialize policy/runtime resources on full reset."""

    async def reset_policy(self, context: Mapping[str, Any]) -> None:
        """Reset all policy runtime state for a new run/session."""

    async def reset_policy_state(self, driver_ids: Iterable[str]) -> None:
        """Reset only selected driver-local model state."""

    async def decide_batch(self, context: Mapping[str, Any]) -> Dict[str, Dict[str, float]]:
        """Return per-driver controls for one batched policy step."""
        driver_ids = list(context.get("driverIds") or [])
        return {driver_id: _zero_action() for driver_id in driver_ids}

    async def publish_preview_frame(self, frame: Mapping[str, Any]) -> None:
        """Optional extension hook called before broadcasting preview frames."""

    # ----- Public helpers --------------------------------------------------

    async def broadcast_preview_frame(
        self,
        snapshot: Mapping[str, Any],
        observation: Mapping[str, Any],
        meta: Optional[Mapping[str, Any]] = None,
    ) -> None:
        """Broadcast one authoritative preview frame to websocket clients."""
        frame = {
            "type": "preview:snapshot",
            "snapshot": dict(snapshot),
            "observation": dict(observation),
            "meta": dict(meta or {}),
        }
        await self.publish_preview_frame(frame)
        payload = frame
        async with self._broadcast_lock:
            stale: List[WebSocket] = []
            for ws in self.state.connections:
                try:
                    await ws.send_json(payload)
                except Exception:
                    stale.append(ws)
            if stale:
                self.state.connections = [ws for ws in self.state.connections if ws not in stale]

    # ----- Internal routing ------------------------------------------------

    def _register_routes(self) -> None:
        @self.app.post("/policy/reset")
        async def policy_reset(body: MutableMapping[str, Any]) -> JSONResponse:
            self.state.session_id += 1
            self.state.controlled_drivers = list(body.get("driverIds") or [])
            await self.init_policy(body)
            await self.reset_policy(body)
            return JSONResponse(
                {
                    "ok": True,
                    "session": {
                        "id": self.state.session_id,
                        "controlledDrivers": self.state.controlled_drivers,
                    },
                }
            )

        @self.app.post("/policy/reset-state")
        async def policy_reset_state(body: MutableMapping[str, Any]) -> JSONResponse:
            driver_ids = list(body.get("driverIds") or [])
            await self.reset_policy_state(driver_ids)
            return JSONResponse(
                {
                    "ok": True,
                    "session": {"id": self.state.session_id},
                    "resetDrivers": driver_ids,
                }
            )

        @self.app.post("/policy/decide-batch")
        async def policy_decide_batch(body: MutableMapping[str, Any]) -> JSONResponse:
            actions = await self.decide_batch(body)
            if not isinstance(actions, dict):
                actions = {}
            now_ms = int(time.time() * 1000)
            return JSONResponse(
                {
                    "ok": True,
                    "session": {"id": self.state.session_id},
                    "actions": actions,
                    "meta": {"serverTsMs": now_ms},
                }
            )

        @self.app.websocket("/preview")
        async def preview_stream(ws: WebSocket) -> None:
            await ws.accept()
            self.state.connections.append(ws)
            try:
                await ws.send_json(
                    {
                        "type": "preview:status",
                        "status": "connected",
                        "session": {"id": self.state.session_id},
                    }
                )
                while True:
                    # Keep connection alive; ignore client messages.
                    await ws.receive_text()
            except WebSocketDisconnect:
                pass
            finally:
                self.state.connections = [conn for conn in self.state.connections if conn is not ws]


def run(host: str = "127.0.0.1", port: int = 8787) -> None:
    server = BasePolicyServer()
    uvicorn.run(server.app, host=host, port=port, log_level="info")


if __name__ == "__main__":
    run()
