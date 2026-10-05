"""Semantic checks for the standalone schema-v1 region navigation artifact."""

from __future__ import annotations

import math
import re
from typing import Any

from ._schema_v1_common import _fail

_IDENTIFIER = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._-]*$")
_SHA256 = re.compile(r"^[0-9a-f]{64}$")


def _exact_keys(value: dict[str, Any], keys: set[str], context: str) -> None:
    if set(value) != keys:
        _fail(f"{context} keys must be exactly {sorted(keys)}")


def _identifier(value: Any, context: str) -> None:
    if not isinstance(value, str) or not _IDENTIFIER.fullmatch(value):
        _fail(f"{context} is invalid")


def _region_navigation_semantics(document: dict[str, Any]) -> None:
    _exact_keys(document, {"schema_version", "format", "navigation_id", "immutable", "reference_space_id", "projection_pack", "grid", "mappings", "provenance"}, "region navigation")
    if document["schema_version"] != "1.0" or document["format"] != "atlas-region-navigation-v1" or document["immutable"] is not True:
        _fail("region navigation version, format, or immutable marker is invalid")
    _identifier(document["navigation_id"], "navigation id")
    _identifier(document["reference_space_id"], "reference space id")

    binding = document["projection_pack"]
    _exact_keys(binding, {"pack_id", "manifest_sha256"}, "projection pack binding")
    _identifier(binding["pack_id"], "projection pack id")
    if not isinstance(binding["manifest_sha256"], str) or not _SHA256.fullmatch(binding["manifest_sha256"]):
        _fail("projection manifest SHA-256 is invalid")

    grid = document["grid"]
    _exact_keys(grid, {"grid_id", "shape", "storage_axes", "index_to_world_um"}, "navigation grid")
    _identifier(grid["grid_id"], "navigation grid id")
    shape = grid["shape"]
    if not isinstance(shape, list) or len(shape) != 3 or any(type(size) is not int or size <= 0 for size in shape):
        _fail("navigation grid shape must contain three positive integers")
    if grid["storage_axes"] != ["ap", "ml", "dv"]:
        _fail("navigation storage axes must be [ap, ml, dv]")
    matrix = grid["index_to_world_um"]
    if not isinstance(matrix, list) or len(matrix) != 16 or any(not isinstance(value, (int, float)) or not math.isfinite(value) for value in matrix):
        _fail("navigation affine must contain 16 finite numbers")
    if matrix[12:] != [0, 0, 0, 1]:
        _fail("navigation affine homogeneous row must be [0, 0, 0, 1]")
    a, b, c, _, d, e, f, _, g, h, i, *_ = matrix
    determinant = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g)
    if not math.isfinite(determinant) or determinant == 0:
        _fail("navigation affine must be nonsingular")

    mappings = document["mappings"]
    _exact_keys(mappings, {"allen", "beryl", "cosmos"}, "navigation mappings")
    for name, descriptor in mappings.items():
        _exact_keys(descriptor, {"format", "resource", "dtype", "shape", "order", "endianness"}, f"{name} navigation array")
        if (descriptor["format"], descriptor["dtype"], descriptor["order"], descriptor["endianness"]) != ("raw-binary-array-v1", "int32", "C", "little"):
            _fail(f"{name} navigation array binary contract is invalid")
        dims = descriptor["shape"]
        if not isinstance(dims, list) or len(dims) != 2 or type(dims[0]) is not int or not 1 <= dims[0] <= 3000 or dims[1] != 4 or type(dims[1]) is not int:
            _fail(f"{name} navigation array shape must be [n, 4] with 1 <= n <= 3000")
        resource = descriptor["resource"]
        codec = resource["codec"]
        byte_count = dims[0] * 16
        if resource["media_type"] != "application/octet-stream" or resource["bytes"] != byte_count or codec["name"] != "none" or codec["decoded_bytes"] != byte_count:
            _fail(f"{name} navigation resource encoding or byte length is invalid")

    provenance = document["provenance"]
    if not isinstance(provenance.get("sources"), list) or not provenance["sources"] or not isinstance(provenance.get("builder"), dict) or not isinstance(provenance.get("recipe"), dict):
        _fail("navigation provenance is invalid")
