"""Derive canonical mesh centroids and mappings from the bilateral 10 um LUT."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

import numpy as np

from .ontology import resolve_mapping, select_grey_matter_source_ids

LABEL_SHAPE = (1320, 1140, 800)  # AP, ML, DV
ORIGINS_UM = (-5739.0, 5400.0, 332.0)  # ML, AP, DV
SPACING_UM = (10.0, -10.0, -10.0)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while block := stream.read(8 * 1024 * 1024):
            digest.update(block)
    return digest.hexdigest()


def _ancestor_source(identifier: int, active: set[int], by_id: dict[int, dict[str, Any]]) -> int | None:
    current = identifier
    visited: set[int] = set()
    while current not in visited:
        if current in active:
            return current
        visited.add(current)
        row = by_id.get(current)
        if row is None or row.get("parent_id") is None:
            return None
        current = abs(int(row["parent_id"]))
    raise ValueError(f"Allen hierarchy cycle at {identifier}")


def build_metadata(lut_path: Path, catalog_path: Path, active_path: Path, output: Path) -> dict[str, Any]:
    catalog = json.loads(catalog_path.read_bytes())
    active_document = json.loads(active_path.read_bytes())
    active_inventory = {abs(int(value)) for value in active_document["allen_ids"]}
    scope = select_grey_matter_source_ids(active_inventory, catalog)
    renderable = set(scope["renderable_ids"])
    unavailable = {545}
    source_ids = sorted(renderable - unavailable)

    allen_rows = catalog["mappings"]["allen"]
    by_id = {int(row["atlas_id"]): row for row in allen_rows if int(row["atlas_id"]) > 0}
    target_by_row = np.zeros(max(int(row["idx"]) for row in allen_rows) + 1, dtype=np.uint16)
    signed_sources = [(identifier, hemisphere) for identifier in source_ids for hemisphere in ("left", "right")]
    source_index = {value: index + 1 for index, value in enumerate(signed_sources)}
    for row in allen_rows:
        row_index = int(row["idx"])
        source = _ancestor_source(abs(int(row["atlas_id"])), renderable, by_id)
        hemisphere = "left" if int(row["atlas_id"]) < 0 else "right"
        if (source, hemisphere) in source_index:
            target_by_row[row_index] = source_index[(source, hemisphere)]

    label = np.load(lut_path, mmap_mode="r")
    if label.shape != LABEL_SHAPE or label.dtype != np.uint16:
        raise ValueError(f"expected uint16 LUT {LABEL_SHAPE}, got {label.dtype} {label.shape}")
    size = len(signed_sources) + 1
    counts = np.zeros(size, dtype=np.int64)
    sums = np.zeros((size, 3), dtype=np.float64)
    ml_coordinates = ORIGINS_UM[0] + np.arange(LABEL_SHAPE[1], dtype=np.float64) * SPACING_UM[0]
    dv_coordinates = ORIGINS_UM[2] + np.arange(LABEL_SHAPE[2], dtype=np.float64) * SPACING_UM[2]
    for ap_start in range(0, LABEL_SHAPE[0], 4):
        ap_stop = min(ap_start + 4, LABEL_SHAPE[0])
        targets = target_by_row[np.asarray(label[ap_start:ap_stop])]
        flat = targets.reshape(-1)
        counts += np.bincount(flat, minlength=size)
        ap_coordinates = ORIGINS_UM[1] + np.arange(ap_start, ap_stop, dtype=np.float64) * SPACING_UM[1]
        sums[:, 0] += np.bincount(flat, weights=np.broadcast_to(ml_coordinates[None, :, None], targets.shape).reshape(-1), minlength=size)
        sums[:, 1] += np.bincount(flat, weights=np.broadcast_to(ap_coordinates[:, None, None], targets.shape).reshape(-1), minlength=size)
        sums[:, 2] += np.bincount(flat, weights=np.broadcast_to(dv_coordinates[None, None, :], targets.shape).reshape(-1), minlength=size)
        if ap_stop % 80 == 0 or ap_stop == LABEL_SHAPE[0]:
            print(f"canonical centroids: {ap_stop}/{LABEL_SHAPE[0]} AP planes", flush=True)
    del label

    if np.any(counts[1:] == 0):
        missing = [signed_sources[index] for index, value in enumerate(counts[1:]) if value == 0]
        raise ValueError(f"renderable signed Allen regions have no canonical voxels: {missing}")
    centroids = sums[1:] / counts[1:, None]
    group_totals: dict[tuple[int, str], tuple[int, np.ndarray]] = {}
    regions = []
    for index, (source_id, hemisphere) in enumerate(signed_sources):
        mappings = {name: resolve_mapping(source_id, name, catalog) for name in ("allen", "beryl", "cosmos")}
        cosmos = mappings["cosmos"]
        if cosmos is None:
            raise ValueError(f"Allen {source_id} has no Cosmos explode group")
        count = int(counts[index + 1])
        centroid = centroids[index]
        group_key = (cosmos, hemisphere)
        group_count, group_sum = group_totals.get(group_key, (0, np.zeros(3, dtype=np.float64)))
        group_totals[group_key] = (group_count + count, group_sum + sums[index + 1])
        regions.append({
            "source_allen_id": source_id,
            "hemisphere": hemisphere,
            "mappings": mappings,
            "voxel_count": count,
            "centroid_um": [round(float(value), 6) for value in centroid],
        })
    explode_groups = [
        {"group_id": group, "hemisphere": hemisphere, "centroid_um": [round(float(value), 6) for value in total / count], "voxel_count": count}
        for (group, hemisphere), (count, total) in sorted(group_totals.items())
    ]
    total_count = int(counts[1:].sum())
    whole = sums[1:].sum(axis=0) / total_count
    document = {
        "format": "atlas-mesh-canonical-metadata-v1",
        "method": "10 um bilateral LUT voxel-centre mean; source regions include canonical descendants",
        "lut": {"bytes": lut_path.stat().st_size, "sha256": _sha256(lut_path)},
        "catalog": {"bytes": catalog_path.stat().st_size, "sha256": _sha256(catalog_path)},
        "active_inventory": {"bytes": active_path.stat().st_size, "sha256": _sha256(active_path)},
        "excluded_source_allen_ids": sorted(unavailable),
        "whole_brain_centroid_um": [round(float(value), 6) for value in whole],
        "explode_groups": explode_groups,
        "regions": regions,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(document, indent=2, sort_keys=True) + "\n")
    return document


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lut", type=Path, required=True)
    parser.add_argument("--catalog", type=Path, required=True)
    parser.add_argument("--active-inventory", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    arguments = parser.parse_args()
    build_metadata(arguments.lut, arguments.catalog, arguments.active_inventory, arguments.output)


if __name__ == "__main__":
    main()
