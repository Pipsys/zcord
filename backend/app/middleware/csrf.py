from __future__ import annotations

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from app.config import get_settings

settings = get_settings()


class CSRFMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if settings.env == "production" and request.method in {"POST", "PUT", "PATCH", "DELETE"} and request.url.path.startswith("/api/v1/auth"):
            refresh = request.cookies.get("refresh_token")
            if refresh:
                cookie_token = request.cookies.get("csrf_token")
                header_token = request.headers.get("X-CSRF-Token")
                if cookie_token and header_token != cookie_token:
                    return JSONResponse(
                        status_code=403,
                        content={
                            "type": "about:blank",
                            "title": "Forbidden",
                            "status": 403,
                            "detail": "CSRF token mismatch",
                            "instance": request.url.path,
                        },
                    )
        return await call_next(request)
