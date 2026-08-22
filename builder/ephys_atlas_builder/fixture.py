from __future__ import annotations

import csv
import hashlib
import shutil
from pathlib import Path

import numpy as np

from .io import encoded_resource, json_resource, write_array, write_json
from .statistics import SUMMARY_FIELDS, describe, histogram, summary_matrix
from .volume import write_chunked_volume


def _artifact(path: Path, root: Path, artifact_id: str, role: str, media_type: str, description: str) -> dict:
    return {
        "id": artifact_id,
        "role": role,
        "resource": encoded_resource(path, root, media_type),
        "description": description,
    }


def generate_golden(out: Path) -> Path:
    out = out.resolve()
    if out.exists():
        shutil.rmtree(out)
    (out / "features" / "rms_ap").mkdir(parents=True)
    (out / "parcellations" / "allen").mkdir(parents=True)

    region_ids = np.array([-362, -382, -477, -803], dtype=np.int32)
    region_index = write_array(
        out / "parcellations" / "allen" / "region_ids.i32",
        region_ids,
        "int32",
        root=out,
    )
    regions = [
        {"index": 0, "atlas_id": -362, "acronym": "R1", "name": "Fixture region 1"},
        {"index": 1, "atlas_id": -382, "acronym": "R2", "name": "Fixture region 2"},
        {"index": 2, "atlas_id": -477, "acronym": "R3", "name": "Fixture region 3"},
        {"index": 3, "atlas_id": -803, "acronym": "R4", "name": "Fixture region 4"},
    ]
    regions_path = out / "parcellations" / "allen" / "regions.json"
    write_json(regions_path, regions)

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
        "schema_version": "1.0",
        "format": "ephys-atlas-regional-statistics-v1",
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
    statistics_path = feature_root / "allen.statistics.json"
    write_json(statistics_path, stats)

    volume = np.arange(8 * 6 * 4, dtype=np.float32).reshape(8, 6, 4) / 10.0
    volume[0, 0, 0] = np.nan
    chunk_shape = (4, 3, 2)
    path_template = "volume/chunks/{i0}.{i1}.{i2}.f32"
    grid_id = "golden-grid-25um"
    resource_index = write_chunked_volume(
        feature_root,
        volume,
        dtype="float32",
        chunk_shape=chunk_shape,
        codec="none",
        path_template=path_template,
        grid_id=grid_id,
    )
    resource_index_path = feature_root / "volume" / "resource-index.json"
    write_json(resource_index_path, resource_index)

    finite_volume = volume[np.isfinite(volume)].astype(np.float64)
    volume_edges = np.linspace(float(finite_volume.min()), float(finite_volume.max()), 9)
    volume_stats = describe(finite_volume)
    volume_summary = {
        "schema_version": "1.0",
        "format": "ephys-atlas-volume-summary-v1",
        "grid_id": grid_id,
        "grid_shape": list(volume.shape),
        "total_voxel_count": int(volume.size),
        "valid_voxel_count": int(finite_volume.size),
        "outside_voxel_count": 0,
        "missing_voxel_count": int(volume.size - finite_volume.size),
        "valid_statistics": {
            field: volume_stats[field]
            for field in ("min", "max", "mean", "std", "q05", "q25", "median", "q75", "q95")
        },
        "histogram": {
            "edges": volume_edges.tolist(),
            "counts": histogram(finite_volume, volume_edges).astype(int).tolist(),
            "bin_rule": "left-closed-right-open-last-closed",
        },
    }
    volume_summary_path = feature_root / "volume" / "summary.json"
    write_json(volume_summary_path, volume_summary)

    feature_csv = feature_root / "rms_ap.csv"
    with feature_csv.open("w", newline="") as f:
        writer = csv.writer(f, lineterminator="\n")
        writer.writerow(["atlas_id", "mean"])
        for atlas_id, value in zip(region_ids, regional_values):
            writer.writerow([int(atlas_id), f"{float(value):.7g}"])

    feature = {
        "schema_version": "1.0",
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
                "format": "ephys-atlas-regional-v1",
                "parcellations": [
                    {
                        "parcellation_id": "allen",
                        "summary": "mean",
                        "values": values_meta,
                        "statistics": json_resource(
                            statistics_path,
                            feature_root,
                            "ephys-atlas-regional-statistics-v1",
                        ),
                    }
                ],
            },
            "volume": {
                "format": "ephys-atlas-volume-v1",
                "grid": {
                    "reference_space_id": "synthetic-reference-space",
                    "grid_id": grid_id,
                    "world_axes": ["ml", "ap", "dv"],
                    "shape": list(volume.shape),
                    "index_to_world_um": [0,25.0,0,0, 25.0,0,0,0, 0,0,25.0,0, 0,0,0,1],
                    "world_to_index": [0,0.04,0,0, 0.04,0,0,0, 0,0,0.04,0, 0,0,0,1],
                    "voxel_edge_extent_um": [-12.5,137.5,-12.5,187.5,-12.5,87.5],
                    "index_convention": "integer-centers-half-integer-edges",
                },
                "array": {"dtype": "float32", "endianness": "little", "order": "C"},
                "validity": {
                    "kind": "sentinel",
                    "outside_value": -9999,
                    "missing_values": "nonfinite",
                    "classification_order": ["outside", "missing", "valid"],
                },
                "summary": json_resource(
                    volume_summary_path,
                    feature_root,
                    "ephys-atlas-volume-summary-v1",
                ),
                "encoding": {
                    "layout": "chunks3d",
                    "resource_index": json_resource(
                        resource_index_path,
                        feature_root,
                        "ephys-atlas-volume-resource-index-v1",
                    ),
                },
            },
        },
        "artifacts": [
            _artifact(feature_csv, feature_root, "rms_ap-csv", "current-feature", "text/csv", "Human-readable regional fixture values")
        ],
    }
    feature_path = feature_root / "feature.json"
    write_json(feature_path, feature)

    source_digest = hashlib.sha256(b"golden-fixture-v1\n").hexdigest()
    manifest = {
        "schema_version": "1.0",
        "dataset_id": "golden_fixture",
        "title": "IBL Ephys Atlas v2 golden fixture",
        "description": "Small deterministic non-scientific dataset used to exercise the schema-v1 browser contract.",
        "release": {"release_id": "golden-v1", "immutable": True, "created_at": "2026-08-22T00:00:00Z", "paper_snapshot": False},
        "provenance": {
            "sources": [{"role": "canonical-data", "description": "Deterministic synthetic fixture seed", "sha256": source_digest}],
            "builder": {"name": "ibl-ephys-atlas-builder", "version": "1.0.0", "repository": "rossant/ibl-ephys-atlas-web-v2", "command": "ephys-atlas-data golden fixtures/golden-v1"},
            "recipe": {"id": "golden-fixture-v1"},
            "notes": ["This fixture is synthetic and has no scientific interpretation."],
        },
        "parcellations": [{
            "id": "allen",
            "region_index": region_index,
            "metadata": json_resource(
                regions_path, out, "ephys-atlas-region-metadata-v1"
            ),
        }],
        "features": [{
            "id": "rms_ap",
            "descriptor": json_resource(
                feature_path, out, "ephys-atlas-feature-v1"
            ),
        }],
        "artifacts": [],
    }
    write_json(out / "manifest.json", manifest)
    return out
