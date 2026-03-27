from __future__ import annotations

import html
import re

HTML_TAG_RE = re.compile(r"<[^>]+>")


def sanitize_message_content(content: str) -> str:
    stripped = HTML_TAG_RE.sub("", content)
    escaped = html.escape(stripped, quote=False)
    return escaped.strip()


def validate_message_length(content: str, max_len: int = 4000) -> str:
    if len(content) > max_len:
        raise ValueError(f"Message exceeds max length of {max_len}")
    return content
