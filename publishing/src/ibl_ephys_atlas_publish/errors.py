"""Stable errors and small validation helpers shared by publishing modules."""

from __future__ import annotations

import re
from typing import Any

ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


class PublishingError(Exception):
    status = 400


class NotFound(PublishingError):
    status = 404


class Forbidden(PublishingError):
    status = 403


class Conflict(PublishingError):
    status = 409


class ValidationError(PublishingError):
    status = 422


class OffsetConflict(Conflict):
    def __init__(self, expected_offset: int):
        self.expected_offset = expected_offset
        super().__init__(f"unexpected upload offset; expected {expected_offset}")


def _id(value: str, kind: str) -> str:
    if not isinstance(value, str) or not ID_RE.fullmatch(value):
        raise ValidationError(f"invalid {kind}")
    return value


def _fields(
    value: dict[str, Any],
    required: set[str],
    optional: set[str],
    context: str,
) -> None:
    missing = required - value.keys()
    unsupported = value.keys() - required - optional
    if missing:
        raise ValidationError(f"{context} is missing {sorted(missing)[0]}")
    if unsupported:
        raise ValidationError(f"{context} contains unsupported {sorted(unsupported)[0]}")
