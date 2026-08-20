"""Build the browser's pinned Allen ontology metadata and SVG crosswalk asset."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import urllib.request
from pathlib import Path
from typing import Any

IBLATLAS_COMMIT = "52083adf44825d0622a503705e095699a5957587"
LEGACY_REGIONS_URL = "https://atlas.internationalbrainlab.org/data/json/regions.json"
LEGACY_REGIONS_SHA256 = "9fca5fe4feeb368c715853c25a97667cb199d5a7ce160385771833ba61cedfc8"
HEX_COLOR = re.compile(r"^#[0-9a-f]{6}$")


def canonical_json(value: Any) -> bytes:
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode("utf-8") + b"\n"


def _download_legacy_crosswalk() -> dict[str, Any]:
    with urllib.request.urlopen(LEGACY_REGIONS_URL) as response:  # noqa: S310 - pinned HTTPS input
        payload = response.read()
    digest = hashlib.sha256(payload).hexdigest()
    if digest != LEGACY_REGIONS_SHA256:
        raise RuntimeError(
            f"legacy region crosswalk SHA-256 changed: expected {LEGACY_REGIONS_SHA256}, got {digest}"
        )
    value = json.loads(payload)
    if not isinstance(value, dict):
        raise ValueError("legacy region crosswalk must be an object")
    return value


def build_document(regions: Any, legacy: dict[str, Any]) -> dict[str, Any]:
    """Join the pinned SVG row domain to authoritative iblatlas ontology fields."""
    mappings: dict[str, list[dict[str, Any]]] = {}
    for mapping in ("allen", "beryl", "cosmos"):
        raw_rows = legacy.get(mapping)
        if not isinstance(raw_rows, list):
            raise ValueError(f"legacy crosswalk has no {mapping} rows")
        rows: list[dict[str, Any]] = []
        for raw in raw_rows:
            atlas_id = int(raw["atlas_id"])
            index = int(raw["idx"])
            if index < 0 or index >= len(regions.id):
                raise ValueError(f"{mapping} legacy index {index} is out of range")
            if int(regions.id[index]) != atlas_id:
                raise ValueError(
                    f"{mapping} atlas id {atlas_id} does not match iblatlas row {index}"
                )
            rgb = [int(channel) for channel in regions.rgb[index]]
            color_hex = f"#{rgb[0]:02x}{rgb[1]:02x}{rgb[2]:02x}"
            if not HEX_COLOR.fullmatch(color_hex):
                raise ValueError(f"invalid color for atlas id {atlas_id}: {color_hex}")
            parent = regions.parent[index]
            row: dict[str, Any] = {
                "acronym": str(regions.acronym[index]),
                "atlas_id": atlas_id,
                "color_hex": color_hex,
                "depth": int(regions.level[index]),
                "idx": index,
                "name": str(regions.name[index]),
                "parent_id": None if parent != parent else int(parent),
            }
            rows.append(row)
        mappings[mapping] = rows
    return {
        "atlas": "Allen Mouse CCF 2017",
        "format": "ibl-atlas-regions-v1",
        "hemisphere_encoding": "signed atlas IDs; negative is left",
        "mappings": mappings,
        "provenance": {
            "iblatlas_commit": IBLATLAS_COMMIT,
            "legacy_svg_crosswalk_sha256": LEGACY_REGIONS_SHA256,
            "legacy_svg_crosswalk_url": LEGACY_REGIONS_URL,
        },
        "schema_version": "1.0",
    }


def main() -> None:
    repository = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output",
        type=Path,
        default=repository / "web/public/atlas/allen-ccf-2017/regions.json",
    )
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    if args.output.exists() and not args.force:
        raise FileExistsError(f"refusing to replace existing asset: {args.output}")

    try:
        from iblatlas.regions import BrainRegions
    except ImportError as exc:
        raise RuntimeError(
            "Allen region generation requires the pinned builder scientific environment"
        ) from exc

    document = build_document(BrainRegions(), _download_legacy_crosswalk())
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(canonical_json(document))


if __name__ == "__main__":
    main()
