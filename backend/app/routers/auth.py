from __future__ import annotations

import secrets
from urllib.parse import urlencode
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from fastapi.responses import JSONResponse
from jose import JWTError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_session
from app.middleware.rate_limit import limiter
from app.redis_client import redis_client
from app.routers.deps import get_current_user, oauth2_scheme
from app.schemas.auth import AuthResponse, LoginRequest, LogoutResponse, OAuthUrlResponse, RefreshRequest, RefreshResponse, RegisterRequest
from app.services.auth_service import AuthService
from app.services.token_revocation_service import revoke_jti
from app.utils.jwt_utils import decode_token

settings = get_settings()
router = APIRouter(prefix="/auth", tags=["auth"])


def _set_auth_cookies(response: Response, refresh_token: str, refresh_exp, csrf_token: str) -> None:
    response.set_cookie(
        "refresh_token",
        refresh_token,
        httponly=True,
        secure=True,
        samesite="strict",
        expires=refresh_exp,
        path="/api/v1/auth",
    )
    response.set_cookie(
        "csrf_token",
        csrf_token,
        httponly=False,
        secure=True,
        samesite="strict",
        expires=refresh_exp,
        path="/api/v1/auth",
    )
    response.headers["X-CSRF-Token"] = csrf_token


def _oauth_provider_config(provider: str) -> dict[str, str]:
    if provider == "google":
        if not settings.google_client_id or not settings.google_client_secret or not settings.google_redirect_uri:
            raise HTTPException(status_code=400, detail="Google OAuth is not configured")
        return {
            "client_id": settings.google_client_id,
            "client_secret": settings.google_client_secret.get_secret_value(),
            "redirect_uri": settings.google_redirect_uri,
            "auth_url": "https://accounts.google.com/o/oauth2/v2/auth",
            "token_url": "https://oauth2.googleapis.com/token",
            "userinfo_url": "https://openidconnect.googleapis.com/v1/userinfo",
            "scope": "openid email profile",
        }

    if provider == "github":
        if not settings.github_client_id or not settings.github_client_secret or not settings.github_redirect_uri:
            raise HTTPException(status_code=400, detail="GitHub OAuth is not configured")
        return {
            "client_id": settings.github_client_id,
            "client_secret": settings.github_client_secret.get_secret_value(),
            "redirect_uri": settings.github_redirect_uri,
            "auth_url": "https://github.com/login/oauth/authorize",
            "token_url": "https://github.com/login/oauth/access_token",
            "userinfo_url": "https://api.github.com/user",
            "scope": "read:user user:email",
        }

    raise HTTPException(status_code=404, detail="Unsupported OAuth provider")


@router.get("/oauth/{provider}/url", response_model=OAuthUrlResponse)
@limiter.limit(settings.auth_rate_limit)
async def oauth_authorize_url(provider: str, request: Request):
    config = _oauth_provider_config(provider)
    state = secrets.token_urlsafe(24)

    await redis_client.setex(f"oauth_state:{provider}:{state}", settings.oauth_state_ttl_seconds, "1")

    query = {
        "client_id": config["client_id"],
        "redirect_uri": config["redirect_uri"],
        "response_type": "code",
        "scope": config["scope"],
        "state": state,
    }
    if provider == "google":
        query["access_type"] = "offline"
        query["include_granted_scopes"] = "true"
        query["prompt"] = "consent"

    return OAuthUrlResponse(provider=provider, auth_url=f"{config['auth_url']}?{urlencode(query)}", state=state)


@router.get("/oauth/{provider}/callback", response_model=AuthResponse)
@limiter.limit(settings.auth_rate_limit)
async def oauth_callback(
    provider: str,
    request: Request,
    response: Response,
    code: str = Query(min_length=10),
    state: str = Query(min_length=12),
    session: AsyncSession = Depends(get_session),
):
    config = _oauth_provider_config(provider)
    state_key = f"oauth_state:{provider}:{state}"
    state_exists = await redis_client.get(state_key)
    if state_exists != "1":
        raise HTTPException(status_code=401, detail="Invalid OAuth state")
    await redis_client.delete(state_key)

    async with httpx.AsyncClient(timeout=15) as client:
        if provider == "github":
            token_resp = await client.post(
                config["token_url"],
                headers={"Accept": "application/json"},
                data={
                    "client_id": config["client_id"],
                    "client_secret": config["client_secret"],
                    "code": code,
                    "redirect_uri": config["redirect_uri"],
                },
            )
        else:
            token_resp = await client.post(
                config["token_url"],
                data={
                    "client_id": config["client_id"],
                    "client_secret": config["client_secret"],
                    "code": code,
                    "redirect_uri": config["redirect_uri"],
                    "grant_type": "authorization_code",
                },
            )

        token_resp.raise_for_status()
        token_data = token_resp.json()
        access_token = token_data.get("access_token")
        if not isinstance(access_token, str):
            raise HTTPException(status_code=401, detail="OAuth token exchange failed")

        if provider == "github":
            user_resp = await client.get(config["userinfo_url"], headers={"Authorization": f"Bearer {access_token}", "Accept": "application/json"})
            user_resp.raise_for_status()
            user_data = user_resp.json()

            emails_resp = await client.get("https://api.github.com/user/emails", headers={"Authorization": f"Bearer {access_token}", "Accept": "application/json"})
            emails_resp.raise_for_status()
            emails = emails_resp.json()
            primary_email = next((item.get("email") for item in emails if item.get("primary") and item.get("verified")), None)
            email = primary_email or user_data.get("email")
            username = user_data.get("login")
        else:
            user_resp = await client.get(config["userinfo_url"], headers={"Authorization": f"Bearer {access_token}"})
            user_resp.raise_for_status()
            user_data = user_resp.json()
            email = user_data.get("email")
            username = user_data.get("name") or user_data.get("given_name") or user_data.get("email", "google_user")

    if not isinstance(email, str) or not isinstance(username, str):
        raise HTTPException(status_code=401, detail="OAuth provider did not return a usable identity")

    auth = AuthService(session)
    user, token_pair, refresh_token, refresh_exp = await auth.oauth_login(
        username=username,
        email=email,
        ip=request.client.host if request.client else None,
        device_info=request.headers.get("user-agent"),
    )

    csrf_token = secrets.token_urlsafe(32)
    _set_auth_cookies(response, refresh_token, refresh_exp, csrf_token)
    return AuthResponse(token=token_pair, user=user, refresh_token=refresh_token)


@router.post("/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit(settings.auth_rate_limit)
async def register(request: Request, payload: RegisterRequest, response: Response, session: AsyncSession = Depends(get_session)):
    auth = AuthService(session)
    user, token_pair, refresh_token, refresh_exp = await auth.register(
        username=payload.username,
        email=payload.email,
        password=payload.password,
        public_key=payload.public_key,
        ip=request.client.host if request.client else None,
    )

    csrf_token = secrets.token_urlsafe(32)
    _set_auth_cookies(response, refresh_token, refresh_exp, csrf_token)
    return AuthResponse(token=token_pair, user=user, refresh_token=refresh_token)


@router.post("/login", response_model=AuthResponse)
@limiter.limit(settings.auth_rate_limit)
async def login(request: Request, payload: LoginRequest, response: Response, session: AsyncSession = Depends(get_session)):
    auth = AuthService(session)
    user, token_pair, refresh_token, refresh_exp = await auth.login(
        login_value=payload.login,
        password=payload.password,
        ip=request.client.host if request.client else None,
        device_info=request.headers.get("user-agent"),
    )

    csrf_token = secrets.token_urlsafe(32)
    _set_auth_cookies(response, refresh_token, refresh_exp, csrf_token)
    return AuthResponse(token=token_pair, user=user, refresh_token=refresh_token)


@router.post("/refresh", response_model=RefreshResponse)
@limiter.limit(settings.auth_rate_limit)
async def refresh(
    request: Request,
    response: Response,
    payload: RefreshRequest | None = None,
    session: AsyncSession = Depends(get_session),
):
    token = payload.refresh_token if payload else None
    if token is None:
        token = request.cookies.get("refresh_token")
    if token is None:
        return JSONResponse(
            status_code=status.HTTP_401_UNAUTHORIZED,
            content={
                "type": "about:blank",
                "title": "Unauthorized",
                "status": 401,
                "detail": "Refresh token cookie missing",
                "instance": str(request.url.path),
            },
        )

    auth = AuthService(session)
    token_pair, new_refresh, refresh_exp = await auth.refresh(token, request.client.host if request.client else None)

    csrf_token = secrets.token_urlsafe(32)
    _set_auth_cookies(response, new_refresh, refresh_exp, csrf_token)
    return RefreshResponse(token=token_pair, refresh_token=new_refresh)


@router.post("/logout", response_model=LogoutResponse)
@limiter.limit(settings.auth_rate_limit)
async def logout(
    request: Request,
    response: Response,
    session: AsyncSession = Depends(get_session),
    user=Depends(get_current_user),
    access_token: str = Depends(oauth2_scheme),
):
    auth = AuthService(session)
    token = request.cookies.get("refresh_token")
    await auth.logout(token, UUID(str(user.id)), request.client.host if request.client else None)

    try:
        payload = decode_token(access_token, expected_type="access")
        jti = payload.get("jti")
        exp = payload.get("exp")
        if isinstance(jti, str) and isinstance(exp, int):
            await revoke_jti(jti, exp)
    except JWTError:
        pass

    response.delete_cookie("refresh_token", path="/api/v1/auth")
    response.delete_cookie("csrf_token", path="/api/v1/auth")
    return LogoutResponse(ok=True)

