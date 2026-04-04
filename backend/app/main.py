from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.config import get_settings
from app.middleware.cors import setup_cors
from app.middleware.csrf import CSRFMiddleware
from app.middleware.rate_limit import problem_details_exception_handler, setup_rate_limiter
from app.middleware.security_headers import SecurityHeadersMiddleware
from app.routers import auth, channels, friends, invites, media, messages, servers, users
from app.websocket.events import GatewayEventType
from app.websocket.handlers import authenticate_websocket_token, handle_client_event, rate_limiter
from app.websocket.manager import manager

settings = get_settings()
is_production = settings.env.lower() == "production"


@asynccontextmanager
async def lifespan(_: FastAPI):
    await manager.start_pubsub()
    yield


app = FastAPI(
    title=settings.app_name,
    debug=settings.debug,
    lifespan=lifespan,
    docs_url=None if is_production else "/docs",
    redoc_url=None if is_production else "/redoc",
    openapi_url=None if is_production else "/openapi.json",
)
setup_cors(app)
setup_rate_limiter(app)
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(CSRFMiddleware)


@app.middleware("http")
async def enforce_https(request: Request, call_next):
    if settings.env == "production":
        forwarded_proto = request.headers.get("x-forwarded-proto", request.url.scheme)
        if forwarded_proto != "https":
            return JSONResponse(
                status_code=status.HTTP_426_UPGRADE_REQUIRED,
                content={
                    "type": "about:blank",
                    "title": "Upgrade Required",
                    "status": 426,
                    "detail": "HTTPS is required",
                    "instance": str(request.url.path),
                },
            )
    return await call_next(request)


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "type": "about:blank",
            "title": "HTTP Error",
            "status": exc.status_code,
            "detail": str(exc.detail),
            "instance": str(request.url.path),
        },
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={
            "type": "about:blank",
            "title": "Validation Error",
            "status": 422,
            "detail": "Request payload validation failed",
            "instance": str(request.url.path),
            "errors": exc.errors(),
        },
    )


app.add_exception_handler(Exception, problem_details_exception_handler)

app.include_router(auth.router, prefix=settings.api_prefix)
app.include_router(users.router, prefix=settings.api_prefix)
app.include_router(servers.router, prefix=settings.api_prefix)
app.include_router(channels.router, prefix=settings.api_prefix)
app.include_router(messages.router, prefix=settings.api_prefix)
app.include_router(friends.router, prefix=settings.api_prefix)
app.include_router(invites.router, prefix=settings.api_prefix)
app.include_router(media.router, prefix=settings.api_prefix)


@app.get("/health")
async def health_check():
    return {"status": "ok"}


@app.websocket("/ws/gateway")
async def websocket_gateway(websocket: WebSocket):
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
    await websocket.send_json(
        {
            "op": "DISPATCH",
            "t": GatewayEventType.READY.value,
            "d": {"user_id": user_id},
        }
    )

    try:
        while True:
            event = await websocket.receive_json()
            await handle_client_event(user_id, websocket, event)
    except WebSocketDisconnect:
        rate_limiter.clear(websocket)
        left_member = await manager.disconnect(user_id, websocket)
        if left_member is not None:
            left_payload = {
                "op": "DISPATCH",
                "t": GatewayEventType.VOICE_USER_LEFT.value,
                "d": left_member,
            }
            await manager.publish_voice(left_member["channel_id"], left_payload)
            left_server_id = left_member.get("server_id")
            if isinstance(left_server_id, str):
                await manager.publish_server(left_server_id, left_payload)


