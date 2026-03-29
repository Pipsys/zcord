from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    app_name: str = "zcord API"
    env: str = "development"
    debug: bool = False
    api_prefix: str = "/api/v1"

    database_url: str = "postgresql+asyncpg://pawcord:pawcord@localhost:5432/pawcord"
    redis_url: str = "redis://:REDIS_SECRET_REMOVED@localhost:6379/0"

    allowed_origins: list[str] = Field(default_factory=lambda: ["https://localhost", "http://localhost:5173"])

    jwt_private_key_path: Path = Path("/run/secrets/jwt_private.pem")
    jwt_public_key_path: Path = Path("/run/secrets/jwt_public.pem")
    jwt_private_key: SecretStr | None = None
    jwt_public_key: SecretStr | None = None
    jwt_algorithm: str = "RS256"
    access_token_ttl_minutes: int = 15
    refresh_token_ttl_days: int = 30

    google_client_id: str | None = None
    google_client_secret: SecretStr | None = None
    google_redirect_uri: str | None = None
    github_client_id: str | None = None
    github_client_secret: SecretStr | None = None
    github_redirect_uri: str | None = None
    oauth_state_ttl_seconds: int = 600

    argon2_time_cost: int = 3
    argon2_memory_cost: int = 65536
    argon2_parallelism: int = 4

    minio_endpoint: str = "localhost:9000"
    minio_public_endpoint: str | None = "localhost:9000"
    minio_access_key: str = "pawcord"
    minio_secret_key: str = "MINIO_SECRET_REMOVED"
    minio_secure: bool = False
    minio_region: str = "us-east-1"
    minio_bucket: str = "pawcord-media"
    upload_url_ttl_seconds: int = 3600
    max_upload_bytes: int = 52_428_800

    auth_rate_limit: str = "5/second"
    default_rate_limit: str = "30/second"
    websocket_event_limit_per_second: int = 100

    presence_ttl_seconds: int = 5
    member_cache_ttl_seconds: int = 30

    @field_validator("allowed_origins", mode="before")
    @classmethod
    def _parse_allowed_origins(cls, value: object) -> list[str]:
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        if isinstance(value, list):
            return [str(item) for item in value]
        return ["https://localhost", "http://localhost:5173"]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
