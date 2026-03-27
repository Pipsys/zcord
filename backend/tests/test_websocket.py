from __future__ import annotations

import anyio
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.main import app
from app.utils.jwt_utils import create_access_token
from app.websocket.manager import manager


def test_websocket_rejects_invalid_token():
    with TestClient(app) as client:
        try:
            with client.websocket_connect("/ws/gateway?token=invalid"):
                assert False, "Connection should be rejected"
        except WebSocketDisconnect as exc:
            assert exc.code == 4401


def test_websocket_accepts_valid_jwt_and_heartbeat():
    token, _ = create_access_token("00000000-0000-0000-0000-000000000001")
    with TestClient(app) as client:
        with client.websocket_connect(f"/ws/gateway?token={token}") as ws:
            ready = ws.receive_json()
            assert ready["t"] == "READY"
            ws.send_json({"t": "HEARTBEAT", "d": {}})
            ack = ws.receive_json()
            assert ack["t"] == "HEARTBEAT_ACK"


def test_websocket_receives_message_create_and_typing_events():
    token, _ = create_access_token("00000000-0000-0000-0000-000000000002")
    with TestClient(app) as client:
        with client.websocket_connect(f"/ws/gateway?token={token}") as ws:
            ready = ws.receive_json()
            assert ready["t"] == "READY"

            ws.send_json({"t": "SUBSCRIBE_SERVER", "d": {"channel_id": "dm-1"}})

            anyio.from_thread.run(
                manager.publish_dm,
                "dm-1",
                {
                    "op": "DISPATCH",
                    "t": "MESSAGE_CREATE",
                    "d": {
                        "id": "m1",
                        "channel_id": "dm-1",
                        "author_id": "00000000-0000-0000-0000-000000000002",
                        "content": "hello over ws",
                        "nonce": None,
                        "type": "default",
                        "reference_id": None,
                        "edited_at": None,
                        "deleted_at": None,
                        "created_at": "2026-03-25T00:00:00+00:00",
                    },
                },
            )

            message_event = ws.receive_json()
            assert message_event["t"] == "MESSAGE_CREATE"
            assert message_event["d"]["content"] == "hello over ws"

            ws.send_json({"t": "TYPING", "d": {"channel_id": "dm-1"}})
            typing_event = ws.receive_json()
            assert typing_event["t"] == "TYPING_START"
