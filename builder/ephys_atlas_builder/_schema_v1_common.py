"""Schema-v1 common semantic checks; no alternate release contract."""

from __future__ import annotations

import json
import math
from typing import Any

from .validate import ValidationError


_DTYPE_BYTES = {
    "uint8": 1,
    "int16": 2,
    "uint16": 2,
    "float16": 2,
    "int32": 4,
    "uint32": 4,
    "float32": 4,
    "float64": 8,
}


def _fail(message: str) -> None:
    raise ValidationError(f"schema v1: {message}")


def _resource_semantics(value: Any) -> None:
    if isinstance(value, list):
        for item in value:
            _resource_semantics(item)
        return
    if not isinstance(value, dict):
        return

    if {"path", "media_type", "bytes", "sha256", "codec"} <= value.keys():
        codec = value["codec"]
        if codec["name"] == "none":
            if codec["decoded_bytes"] != value["bytes"]:
                _fail(f"uncompressed resource {value['path']} has unequal encoded and decoded lengths")
            if "level" in codec:
                _fail(f"uncompressed resource {value['path']} cannot declare a compression level")

    if value.get("format") == "raw-binary-array-v1":
        dtype = value["dtype"]
        expected = math.prod(value["shape"]) * _DTYPE_BYTES[dtype]
        if value["resource"]["codec"]["decoded_bytes"] != expected:
            _fail(f"binary array {value['resource']['path']} decoded length does not match dtype and shape")
        expected_endianness = "not-applicable" if dtype == "uint8" else "little"
        if value["endianness"] != expected_endianness:
            _fail(f"binary dtype {dtype} requires {expected_endianness} endianness")

    for child in value.values():
        _resource_semantics(child)


def _unique(items: list[Any], description: str) -> None:
    normalized = [json.dumps(item, sort_keys=True) for item in items]
    if len(normalized) != len(set(normalized)):
        _fail(f"duplicate {description}")


def _increasing(values: list[float], description: str) -> None:
    if not all(math.isfinite(value) for value in values):
        _fail(f"{description} must be finite")
    if not all(left < right for left, right in zip(values, values[1:])):
        _fail(f"{description} must be strictly increasing")
