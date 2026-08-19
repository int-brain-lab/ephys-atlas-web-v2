from __future__ import annotations

import csv
import hashlib
import shutil
from pathlib import Path

import numpy as np

from .io import sha256_file, write_array, write_json
from .statistics import SUMMARY_FIELDS, describe, histogram, summary_matrix
from .volume import write_chunked_volume


def _artifact(path: Path, root: Path, artifact_id: str, role: str, media_type: str, description: str) -> dict:
    return {
        "id": artifact_id,
        "role": role,
        "path": path.relative_to(root).as_posix(),
        "media_type": media_type,
        "bytes": path.stat().st_size,
        "sha256": sha256_file(path),
        "description": description,
    }


def generate_golden(out: Path) -> Path:
    out = out.resolve()
    if out.exists():
        shutil.rmtree(out)
    (out / "features" / "rms_ap").mkdir(parents=True)
    (out / "parcellations" / "allen").mkdir(parents=True)

    region_ids = np.array([10, 20, 30, 40], dtype=np.int32)
    region_index = write_array(out / "parcellations" / "allen" / "region_ids.i32", region_ids, "int32")
    region_index["path"] = "parcellations/allen/region_ids.i32"
    regions = [
        {"index": 0, "atlas_id": 10, "acronym": "R1", "name": "Fixture region 1"},
        {"index": 1, "atlas_id": 20, "acronym": "R2", "name": "Fixture region 2"},
        {"index": 2, "atlas_id": 30, "acronym": "R3", "name": "Fixture region 3"},
        {"index": 3, "atlas_id": 40, "acronym": "R4", "name": "Fixture region 4"},
    ]
    write_json(out / "parcellations" / "allen" / "regions.json", regions)

    samples = [
        np.array([0.5, 1.0, 1.5]),
        np.array([1.5, 2.0, np.nan, 2.5]),
        np.array([-0.5, 0.0, 0.5]),
        np.array([3.0, 3.5]),
    ]
    regional_values = np.array([np.nanmean(x) for x in samples], dtype=np.float32)
    feature_root = out / "features" / "rms_ap"
    values_meta = write_array(feature_root / "allen.values.f32", regional_values, "float32")
    edges = np.linspace(-0.5, 3.5, 9, dtype=np.float64)
    stat_matrix = summary_matrix(samples)
    stat_meta = write_array(feature_root / "allen.summary.f64", stat_matrix, "float64")
    regional_hist = np.stack([histogram(x, edges) for x in samples])
    hist_meta = write_array(feature_root / "allen.hist.u32", regional_hist, "uint32")
    all_samples = np.concatenate(samples)
    global_stats = describe(all_samples)
    stats = {
        "format": "ephys-atlas-statistics-v0.1",
        "population": "synthetic fixture observations assigned to Allen fixture regions",
        "global": global_stats,
        "regional_summary": {"fields": SUMMARY_FIELDS, "values": stat_meta},
        "histogram": {
            "edges": edges.tolist(),
            "global_counts": histogram(all_samples, edges).astype(int).tolist(),
            "regional_counts": hist_meta,
            "bin_rule": "left-closed-right-open-last-closed",
        },
    }
    write_json(feature_root / "allen.statistics.json", stats)

    volume = np.arange(8 * 6 * 4, dtype=np.float32).reshape(8, 6, 4) / 10.0
    volume[0, 0, 0] = np.nan
    chunk_shape = (4, 3, 2)
    path_template = "volume/chunks/{i0}.{i1}.{i2}.f32"
    write_chunked_volume(feature_root, volume, dtype="float32", chunk_shape=chunk_shape, codec="none", path_template=path_template)

    feature_csv = feature_root / "rms_ap.csv"
    with feature_csv.open("w", newline="") as f:
        writer = csv.writer(f, lineterminator="\n")
        writer.writerow(["atlas_id", "mean"])
        for atlas_id, value in zip(region_ids, regional_values):
            writer.writerow([int(atlas_id), f"{float(value):.7g}"])

    feature = {
        "schema_version": "0.1",
        "id": "rms_ap",
        "label": "AP RMS (golden fixture)",
        "description": "Synthetic feature exercising regional values, descriptive statistics, histogram, volume chunks and download metadata.",
        "unit": "dB rel. V",
        "value_semantics": {
            "quantity": "synthetic AP RMS-like scalar",
            "transform": "identity; fixture values are already display values",
            "source_population": "synthetic fixture observations",
            "missing_values": "non-finite observations are excluded from summaries and histograms",
            "source_column": "rms_ap",
            "qc_filter": "none; synthetic fixture",
        },
        "representations": {
            "regional": {
                "format": "ephys-atlas-regional-v0.1",
                "parcellations": [
                    {
                        "parcellation_id": "allen",
                        "summary": "mean",
                        "values": values_meta,
                        "statistics": "allen.statistics.json",
                    }
                ],
            },
            "volume": {
                "format": "ephys-atlas-chunked-volume-v0.1",
                "layout": "chunks3d",
                "grid": {
                    "shape": list(volume.shape),
                    "axis_order": ["ap", "ml", "dv"],
                    "coordinate_system": "fixture-index-space; not Allen CCF",
                    "voxel_size_um": [25.0, 25.0, 25.0],
                    "origin_um": [0.0, 0.0, 0.0],
                    "index_to_world_um": [25.0,0,0,0, 0,25.0,0,0, 0,0,25.0,0, 0,0,0,1],
                },
                "array": {"dtype": "float32", "endianness": "little", "order": "C", "nonfinite": "preserve"},
                "chunks": {"shape": list(chunk_shape), "codec": {"name": "none"}, "path_template": path_template},
                "value_range": [float(np.nanmin(volume)), float(np.nanmax(volume))],
                "statistics": "allen.statistics.json",
            },
        },
        "artifacts": [
            _artifact(feature_csv, feature_root, "rms_ap-csv", "current-feature", "text/csv", "Human-readable regional fixture values")
        ],
    }
    write_json(feature_root / "feature.json", feature)

    source_digest = hashlib.sha256(b"golden-fixture-v0.1\n").hexdigest()
    manifest = {
        "schema_version": "0.1",
        "dataset_id": "golden_fixture",
        "title": "IBL Ephys Atlas v2 golden fixture",
        "description": "Small deterministic non-scientific dataset used to exercise the v0.1 browser contract.",
        "release": {"release_id": "golden-v0.1", "immutable": True, "created_at": "2026-08-19T00:00:00Z", "paper_snapshot": False},
        "provenance": {
            "sources": [{"role": "canonical-data", "description": "Deterministic synthetic fixture seed", "sha256": source_digest}],
            "builder": {"name": "ibl-ephys-atlas-builder", "version": "0.1.0", "repository": "rossant/ibl-ephys-atlas-web-v2", "command": "ephys-atlas-data golden fixtures/golden-v0.1"},
            "recipe": {"id": "golden-fixture-v0.1"},
            "notes": ["This fixture is synthetic and has no scientific interpretation."],
        },
        "parcellations": [{"id": "allen", "region_index": region_index, "metadata": "parcellations/allen/regions.json"}],
        "features": [{"id": "rms_ap", "path": "features/rms_ap/feature.json"}],
        "artifacts": [],
    }
    write_json(out / "manifest.json", manifest)
    return out
