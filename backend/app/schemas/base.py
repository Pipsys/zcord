from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class StrictSchema(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, str_strip_whitespace=True)


class ProblemDetails(StrictSchema):
    type: str = "about:blank"
    title: str
    status: int
    detail: str
    instance: str | None = None
