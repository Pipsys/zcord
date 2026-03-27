from __future__ import annotations

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.websocket.handlers import authenticate_websocket_token
from app.websocket.manager import manager

router = APIRouter(tags=["voice"])


@router.websocket("/ws/voice/{channel_id}")
async def voice_ws(websocket: WebSocket, channel_id: str):
    token = websocket.query_params.get("token")
    if token is None:
        await websocket.close(code=4401)
        return

    try:
        user_id = await authenticate_websocket_token(token)
    except ValueError:
        await websocket.close(code=4401)
        return

    await manager.connect(user_id, websocket)
    await manager.subscribe_dm(channel_id, websocket)

    try:
        while True:
            incoming = await websocket.receive_json()
            payload = {
                "op": "DISPATCH",
                "t": "VOICE_STATE_UPDATE",
                "d": {
                    "channel_id": channel_id,
                    "user_id": user_id,
                    "signal": incoming,
                },
            }
            await manager.publish_dm(channel_id, payload)
    except WebSocketDisconnect:
        await manager.disconnect(user_id, websocket)

