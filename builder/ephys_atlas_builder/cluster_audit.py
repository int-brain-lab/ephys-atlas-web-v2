from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Mapping, Sequence

import numpy as np

from .io import canonical_json, sha256_file, write_json


AUDIT_ID = "ephys-atlas-clusters-source-audit-v1"
DATASET_ID = "ephys_atlas_clusters"


def _upstream_metadata(features: Sequence[str]) -> Mapping[str, dict]:
    try:
        import ephysatlas.cells
    except ImportError as exc:
        raise RuntimeError(
            "cluster source audit requires the pinned ephysatlas scientific environment"
        ) from exc

    columns = ephysatlas.cells.ModelClusters.to_schema().columns
    output = {}
    for feature in features:
        column = columns.get(feature)
        metadata = getattr(column, "metadata", None) or {}
        unit = (
            metadata.get("transformed_unit")
            or metadata.get("raw_unit")
            or metadata.get("unit")
        )
        if unit in {"N/A", "n/a", ""}:
            unit = None
        output[feature] = {
            "unit": unit,
            "description": getattr(column, "description", None),
        }
    return output


def _distribution(values: np.ndarray, bins: int) -> dict:
    finite = values[np.isfinite(values)]
    missing = len(values) - len(finite)
    if len(finite) == 0:
        return {
            "total_count": len(values),
            "finite_count": 0,
            "missing_count": missing,
            "nan_count": int(np.isnan(values).sum()),
            "positive_infinity_count": int(np.isposinf(values).sum()),
            "negative_infinity_count": int(np.isneginf(values).sum()),
            "zero_count": 0,
            "negative_count": 0,
            "summary": None,
            "histogram": None,
        }

    quantiles = np.quantile(
        finite,
        [0.01, 0.05, 0.25, 0.5, 0.75, 0.95, 0.99],
    )
    counts, edges = np.histogram(finite, bins=bins)
    return {
        "total_count": len(values),
        "finite_count": len(finite),
        "missing_count": missing,
        "nan_count": int(np.isnan(values).sum()),
        "positive_infinity_count": int(np.isposinf(values).sum()),
        "negative_infinity_count": int(np.isneginf(values).sum()),
        "zero_count": int((finite == 0).sum()),
        "negative_count": int((finite < 0).sum()),
        "summary": {
            "min": float(finite.min()),
            "q01": float(quantiles[0]),
            "q05": float(quantiles[1]),
            "q25": float(quantiles[2]),
            "median": float(quantiles[3]),
            "q75": float(quantiles[4]),
            "q95": float(quantiles[5]),
            "q99": float(quantiles[6]),
            "max": float(finite.max()),
            "mean": float(finite.mean()),
            "std": float(finite.std()),
        },
        "histogram": {
            "bin_edges": [float(value) for value in edges],
            "counts": [int(value) for value in counts],
        },
    }


def audit_cluster_snapshot(
    source_snapshot: Path,
    output: Path,
    *,
    project: str,
    features: Sequence[str],
    histogram_bins: int = 20,
    upstream_metadata: Mapping[str, dict] | None = None,
) -> Path:
    if not features or len(set(features)) != len(features):
        raise ValueError("cluster audit requires a nonempty feature list without duplicates")
    if histogram_bins < 2:
        raise ValueError("histogram_bins must be >= 2")

    source_json = source_snapshot / "source.json"
    if not source_json.is_file():
        raise RuntimeError(f"missing source snapshot metadata: {source_json}")
    source = json.loads(source_json.read_text())
    if source.get("dataset_id") != DATASET_ID:
        raise RuntimeError(f"source snapshot is not {DATASET_ID}: {source.get('dataset_id')}")
    if source.get("project") != project:
        raise RuntimeError(
            f"source project {source.get('project')} does not match requested project {project}"
        )
    release_id = str(source.get("resolved_release"))
    expected_release = "sha256-" + hashlib.sha256(
        canonical_json(source.get("files") or [])
    ).hexdigest()[:16]
    if release_id != expected_release or source_snapshot.name != release_id:
        raise RuntimeError(
            f"source snapshot identity mismatch: metadata={release_id}, content={expected_release}, directory={source_snapshot.name}"
        )

    relative_table = f"{project}/cells_aggregates/clusters.table.pqt"
    descriptor = next(
        (item for item in source.get("files") or [] if item.get("path") == relative_table),
        None,
    )
    if descriptor is None:
        raise RuntimeError(f"source snapshot does not declare {relative_table}")
    table = source_snapshot / relative_table
    if not table.is_file():
        raise RuntimeError(f"source snapshot is missing {relative_table}")
    if table.stat().st_size != descriptor.get("bytes") or sha256_file(table) != descriptor.get("sha256"):
        raise RuntimeError(f"source table integrity mismatch: {relative_table}")

    try:
        import pandas as pd
        import pyarrow.parquet as pq
    except ImportError as exc:
        raise RuntimeError("cluster source audit requires pandas and pyarrow") from exc

    parquet = pq.ParquetFile(table)
    schema = parquet.schema_arrow
    missing_features = [feature for feature in features if feature not in schema.names]
    if missing_features:
        raise RuntimeError(
            f"candidate cluster features are missing: {', '.join(missing_features)}"
        )
    frame = pd.read_parquet(table, columns=list(features))
    metadata = upstream_metadata or _upstream_metadata(features)
    audited_features = []
    for feature in features:
        values = frame[feature].to_numpy(dtype=np.float64, copy=False)
        declared = metadata.get(feature) or {}
        audited_features.append(
            {
                "id": feature,
                "present": True,
                "source_dtype": str(schema.field(feature).type),
                "unit": declared.get("unit"),
                "description": declared.get("description"),
                **_distribution(values, histogram_bins),
            }
        )

    report = {
        "schema_version": "1.0",
        "audit_id": AUDIT_ID,
        "dataset_id": DATASET_ID,
        "project": project,
        "release_id": release_id,
        "population": "every row of cells_aggregates/clusters.table.pqt; no good-unit filter",
        "source": {
            "snapshot_manifest_sha256": sha256_file(source_json),
            "table": descriptor,
            "row_count": parquet.metadata.num_rows,
            "row_groups": parquet.metadata.num_row_groups,
        },
        "histogram_bins": histogram_bins,
        "features": audited_features,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    write_json(output, report)
    return output
