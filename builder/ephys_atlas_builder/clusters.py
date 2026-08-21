from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
import re
import shutil
from typing import Mapping, Sequence

import numpy as np

from .io import sha256_file, write_json
from .regional_release import (
    DEFAULT_PARCELLATIONS,
    FeatureInfo,
    RegionInfo,
    fold_region_ids_left,
    histogram_edges,
    write_feature_parcellation,
    write_parcellation,
)

DATASET_ID = "ephys_atlas_clusters"
_COMMIT_RE = re.compile(r"^[0-9a-f]{7,40}$")


@dataclass(frozen=True)
class ClusterBuildConfig:
    release_id: str
    created_at: str
    project: str
    population: str = "all"
    parcellations: tuple[str, ...] = DEFAULT_PARCELLATIONS
    features: tuple[str, ...] | None = None
    histogram_bins: int = 50
    paper_snapshot: bool = False
    ibleatools_commit: str | None = None
    iblatlas_commit: str | None = None
    builder_commit: str | None = None

    def validate(self) -> None:
        if not self.release_id:
            raise ValueError("release_id is required")
        if not self.created_at:
            raise ValueError("created_at is required for deterministic release metadata")
        if not self.project:
            raise ValueError("project is required and must identify the source cohort")
        if self.population != "all":
            raise ValueError("cluster population must be 'all'; no implicit good-unit or other QC filter is approved")
        if self.histogram_bins < 2:
            raise ValueError("histogram_bins must be >= 2")
        unknown = sorted(set(self.parcellations) - set(DEFAULT_PARCELLATIONS))
        if unknown:
            raise ValueError(f"unsupported parcellations: {', '.join(unknown)}")
        if not self.parcellations:
            raise ValueError("at least one parcellation is required")
        for name, value in (
            ("ibleatools_commit", self.ibleatools_commit),
            ("iblatlas_commit", self.iblatlas_commit),
            ("builder_commit", self.builder_commit),
        ):
            if value is not None and not _COMMIT_RE.fullmatch(value):
                raise ValueError(f"{name} must be a 7-40 character lowercase Git commit")

    def require_scientific_pins(self) -> None:
        missing = [
            name
            for name, value in (
                ("ibleatools_commit", self.ibleatools_commit),
                ("iblatlas_commit", self.iblatlas_commit),
                ("builder_commit", self.builder_commit),
            )
            if value is None
        ]
        if missing:
            raise ValueError(f"snapshot builds require reproducibility pins: {', '.join(missing)}")

    def require_feature_catalog(self) -> None:
        if not self.features:
            raise ValueError("snapshot builds require an explicit nonempty cluster feature catalog")


def build_clusters_release_from_arrays(
    release_dir: Path,
    config: ClusterBuildConfig,
    feature_values: Mapping[str, np.ndarray],
    parcellation_ids: Mapping[str, np.ndarray],
    region_metadata: Mapping[str, Mapping[int, RegionInfo]],
    provenance_sources: Sequence[dict],
    feature_metadata: Mapping[str, FeatureInfo] | None = None,
) -> Path:
    """Build regional summaries with one equal-weight observation per cluster."""
    config.validate()
    release_dir = release_dir.resolve()
    if release_dir.exists() and any(release_dir.iterdir()):
        raise ValueError(f"release directory is not empty: {release_dir}")
    release_dir.mkdir(parents=True, exist_ok=True)

    if not feature_values:
        raise ValueError("at least one cluster feature is required")
    missing_parcellations = [p for p in config.parcellations if p not in parcellation_ids]
    if missing_parcellations:
        raise ValueError(f"missing region ids for: {', '.join(missing_parcellations)}")
    lengths = {len(np.asarray(values)) for values in feature_values.values()}
    lengths.update(len(np.asarray(parcellation_ids[p])) for p in config.parcellations)
    if len(lengths) != 1:
        raise ValueError("feature and parcellation arrays must have the same row count")

    parcellation_entries = []
    group_rows: dict[str, list[np.ndarray]] = {}
    for parcellation in config.parcellations:
        metadata = region_metadata.get(parcellation)
        if metadata is None:
            raise ValueError(f"missing {parcellation} region metadata")
        entry, groups = write_parcellation(
            release_dir,
            parcellation,
            np.asarray(parcellation_ids[parcellation]),
            metadata,
        )
        parcellation_entries.append(entry)
        group_rows[parcellation] = groups

    population_description = "all cluster rows in clusters.table.pqt; finite values included independently per feature"
    feature_metadata = feature_metadata or {}
    features = []
    for feature_id in sorted(feature_values):
        values = np.asarray(feature_values[feature_id], dtype=np.float64)
        edges = histogram_edges(values, config.histogram_bins)
        feature_root = release_dir / "features" / feature_id
        regional = [
            write_feature_parcellation(
                feature_root,
                parcellation,
                values,
                group_rows[parcellation],
                edges,
                population_description,
            )
            for parcellation in config.parcellations
        ]
        info = feature_metadata.get(feature_id)
        source_column = info.source_column if info else feature_id
        feature_doc = {
            "schema_version": "0.1",
            "id": feature_id,
            "label": info.label if info else feature_id.replace("_", " "),
            "description": info.description if info else f"Cluster feature {source_column} aggregated regionally over all finite clusters.",
            "unit": info.unit if info else None,
            "value_semantics": {
                "quantity": source_column,
                "transform": "identity from clusters.table.pqt; no value clipping or replacement",
                "source_population": population_description,
                "missing_values": "non-finite observations are excluded independently per feature",
                "source_column": source_column,
                "qc_filter": "none (all clusters)",
            },
            "representations": {
                "regional": {
                    "format": "ephys-atlas-regional-v0.1",
                    "parcellations": regional,
                }
            },
            "artifacts": [],
        }
        write_json(feature_root / "feature.json", feature_doc)
        features.append({"id": feature_id, "path": f"features/{feature_id}/feature.json"})

    scientific_sources = []
    for description, repository, commit in (
        ("ephysatlas cluster table schema and cell feature definitions", "int-brain-lab/ibleatools", config.ibleatools_commit),
        ("IBL atlas parcellation mappings", "int-brain-lab/iblatlas", config.iblatlas_commit),
    ):
        if commit:
            scientific_sources.append(
                {
                    "role": "scientific-code",
                    "description": description,
                    "repository": repository,
                    "commit": commit,
                }
            )

    manifest = {
        "schema_version": "0.1",
        "dataset_id": DATASET_ID,
        "title": "IBL Ephys Atlas cluster features",
        "description": "Regional descriptive summaries of cluster-level ephys-atlas features.",
        "release": {
            "release_id": config.release_id,
            "immutable": True,
            "created_at": config.created_at,
            "paper_snapshot": config.paper_snapshot,
        },
        "provenance": {
            "sources": [*provenance_sources, *scientific_sources],
            "builder": {
                "name": "ibl-ephys-atlas-builder",
                "version": "0.1.0",
                "repository": "rossant/ibl-ephys-atlas-web-v2",
                **({"commit": config.builder_commit} if config.builder_commit else {}),
                "command": f"ephys-atlas-data build-clusters {config.release_id} --project {config.project} --population all",
            },
            "recipe": {
                "id": "ephys-atlas-clusters-regional-v0.1",
                "project": config.project,
                "population": "all",
                "parcellations": list(config.parcellations),
                "features": sorted(feature_values),
                "regional_summary": "arithmetic mean of all finite clusters in each region",
                "regional_statistics": [
                    "count", "missing_count", "min", "max", "mean", "std",
                    "median", "q05", "q25", "q75", "q95",
                ],
                "histogram_bins": config.histogram_bins,
                "hemisphere": "bilateral observations folded onto left atlas ids using -abs(id)",
                "weighting": "one equal-weight observation per finite cluster; no insertion balancing",
                "qc_filter": "none; clusters_good.table.pqt is not used",
            },
        },
        "parcellations": parcellation_entries,
        "features": features,
        "artifacts": [],
    }
    write_json(release_dir / "manifest.json", manifest)
    return release_dir


def discover_cluster_project_dir(source_snapshot: Path) -> Path:
    candidates = sorted(
        path.parent.parent
        for path in source_snapshot.rglob("cells_aggregates/clusters.table.pqt")
        if (path.parent / "clusters_good.table.pqt").is_file()
    )
    if len(candidates) != 1:
        raise RuntimeError(
            "expected exactly one cluster project directory containing "
            f"cells_aggregates/clusters.table.pqt; found {len(candidates)}"
        )
    return candidates[0]


def _cluster_scientific_inputs(source_snapshot: Path, config: ClusterBuildConfig):
    try:
        import pandas as pd
        import ephysatlas.anatomy
        import ephysatlas.cells
    except ImportError as exc:
        raise RuntimeError(
            "building cluster releases requires current ibleatools/ephysatlas, pandas, and iblatlas"
        ) from exc

    project_dir = discover_cluster_project_dir(source_snapshot)
    frame = pd.read_parquet(project_dir / "cells_aggregates/clusters.table.pqt")
    frame = pd.DataFrame(ephysatlas.cells.ModelClusters(frame))
    if "atlas_id" not in frame.columns:
        raise RuntimeError("cluster table has no atlas_id column")

    config.require_feature_catalog()
    assert config.features is not None
    requested = list(config.features)
    missing = [feature for feature in requested if feature not in frame.columns]
    if missing:
        raise RuntimeError(f"requested cluster features are missing: {', '.join(missing)}")
    features = [feature for feature in requested if feature in frame.columns]
    if not features:
        raise RuntimeError("no canonical scalar cluster features are present")

    feature_values = {
        feature: frame[feature].to_numpy(dtype=np.float64, copy=False)
        for feature in features
    }
    model_columns = ephysatlas.cells.ModelClusters.to_schema().columns
    feature_metadata = {}
    for feature in features:
        column = model_columns.get(feature)
        metadata = getattr(column, "metadata", None) or {}
        unit = metadata.get("transformed_unit") or metadata.get("raw_unit") or metadata.get("unit")
        if unit in {"N/A", "n/a", ""}:
            unit = None
        description = getattr(column, "description", None) or f"Cluster feature {feature}"
        feature_metadata[feature] = FeatureInfo(
            source_column=feature,
            label=metadata.get("label") or feature.replace("_", " "),
            description=(
                f"{description} Arithmetic mean and descriptive statistics over all "
                "finite clusters assigned to each region."
            ),
            unit=unit,
        )

    atlas = ephysatlas.anatomy.ClassifierAtlas()
    allen_ids = frame["atlas_id"].to_numpy(copy=False)
    parcellation_ids = {}
    for parcellation in config.parcellations:
        if parcellation == "allen":
            parcellation_ids[parcellation] = allen_ids
        else:
            parcellation_ids[parcellation] = atlas.regions.remap(
                allen_ids, "Allen", parcellation.capitalize()
            )

    atlas_lookup = {
        int(region_id): RegionInfo(int(region_id), str(acronym), str(name))
        for region_id, acronym, name in zip(atlas.regions.id, atlas.regions.acronym, atlas.regions.name)
    }
    region_metadata = {}
    for parcellation in config.parcellations:
        ids = fold_region_ids_left(parcellation_ids[parcellation])
        unique = sorted({int(value) for value in ids[np.isfinite(ids)]})
        region_metadata[parcellation] = {
            region_id: atlas_lookup.get(region_id, atlas_lookup.get(abs(region_id)))
            for region_id in unique
            if region_id in atlas_lookup or abs(region_id) in atlas_lookup
        }
    return feature_values, parcellation_ids, region_metadata, feature_metadata


def build_clusters_from_snapshot(
    source_snapshot: Path,
    release_dir: Path,
    config: ClusterBuildConfig,
) -> Path:
    config.validate()
    config.require_scientific_pins()
    config.require_feature_catalog()
    source_json = source_snapshot / "source.json"
    if not source_json.is_file():
        raise RuntimeError(f"missing source snapshot metadata: {source_json}")
    source = json.loads(source_json.read_text())
    if source.get("dataset_id") != DATASET_ID:
        raise RuntimeError(f"source snapshot is not {DATASET_ID}: {source.get('dataset_id')}")
    if str(source.get("resolved_release")) != config.release_id:
        raise RuntimeError(
            f"source release {source.get('resolved_release')} does not match requested release {config.release_id}"
        )
    if source.get("project") != config.project:
        raise RuntimeError(
            f"source project {source.get('project')} does not match requested project {config.project}"
        )

    canonical = source.get("canonical_source") or {}
    provenance_sources = [
        {
            "role": "canonical-data",
            "description": "Content-addressed ephysatlas all-cluster snapshot",
            "release": config.release_id,
            **({"uri": canonical["uri"]} if canonical.get("uri") else {}),
        },
        {
            "role": "publication-input",
            "description": "Checksummed source snapshot manifest used by the builder",
            "path": "source.json",
            "sha256": sha256_file(source_json),
        },
    ]
    inputs = _cluster_scientific_inputs(source_snapshot, config)
    result = build_clusters_release_from_arrays(
        release_dir,
        config,
        *inputs[:3],
        provenance_sources,
        inputs[3],
    )
    shutil.copyfile(source_json, result / "source.json")
    return result
