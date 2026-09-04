from __future__ import annotations

from dataclasses import dataclass, replace
import json
from pathlib import Path
import re
import shlex
import shutil
from typing import Mapping, Sequence

import numpy as np

from .build_environment import build_environment
from .io import json_resource, sha256_file, write_json
from .distribution_selection import (
    bind_distribution_selection,
    load_distribution_selection,
    selection_provenance,
)
from .regional_release import (
    DEFAULT_PARCELLATIONS,
    FeatureInfo,
    RegionInfo,
    fold_region_ids_left,
    linear_full_display,
    validate_scalar_display,
    write_feature_parcellation,
    write_parcellation,
)

DATASET_ID = "ephys_atlas_clusters"
_COMMIT_RE = re.compile(r"^[0-9a-f]{7,40}$")


def _builder_command(config: "ClusterBuildConfig") -> str:
    command = [
        "ephys-atlas-data",
        "build-clusters",
        config.source_release_id or config.release_id,
        "--release-id",
        config.release_id,
        "--project",
        config.project,
        "--population",
        config.population,
        "--created-at",
        config.created_at,
        "--catalog-selection",
        str(config.catalog_selection or Path("catalog-selection.json")),
        "--distribution-selection",
        str(config.distribution_selection or Path("distribution-selection.json")),
        "--histogram-bins",
        str(config.histogram_bins),
    ]
    for parcellation in config.parcellations:
        command.extend(("--parcellation", parcellation))
    if config.paper_snapshot:
        command.append("--paper-snapshot")
    for name, value in (
        ("--ibleatools-commit", config.ibleatools_commit),
        ("--iblatlas-commit", config.iblatlas_commit),
        ("--builder-commit", config.builder_commit),
    ):
        if value:
            command.extend((name, value))
    return shlex.join(command)


@dataclass(frozen=True)
class ClusterBuildConfig:
    release_id: str
    created_at: str
    project: str
    source_release_id: str | None = None
    population: str = "all"
    parcellations: tuple[str, ...] = DEFAULT_PARCELLATIONS
    features: tuple[str, ...] | None = None
    histogram_bins: int = 50
    paper_snapshot: bool = False
    ibleatools_commit: str | None = None
    iblatlas_commit: str | None = None
    builder_commit: str | None = None
    catalog_selection: Path | None = None
    distribution_selection: Path | None = None

    def validate(self) -> None:
        if not self.release_id:
            raise ValueError("release_id is required")
        if not self.created_at:
            raise ValueError(
                "created_at is required for deterministic release metadata"
            )
        if not self.project:
            raise ValueError("project is required and must identify the source cohort")
        if self.population != "all":
            raise ValueError(
                "cluster population must be 'all'; no implicit good-unit or other QC filter is approved"
            )
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
                raise ValueError(
                    f"{name} must be a 7-40 character lowercase Git commit"
                )

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
            raise ValueError(
                f"snapshot builds require reproducibility pins: {', '.join(missing)}"
            )

    def require_feature_catalog(self) -> None:
        if not self.features:
            raise ValueError(
                "snapshot builds require an explicit nonempty cluster feature catalog"
            )


@dataclass(frozen=True)
class ClusterCatalogSelection:
    path: Path
    sha256: str
    source_release_id: str
    project: str
    table_path: str
    table_bytes: int
    table_sha256: str
    legacy_repository: str
    legacy_commit: str
    legacy_feature_source_path: str
    legacy_feature_source_sha256: str
    legacy_unit_source_path: str
    legacy_unit_source_sha256: str
    features: tuple[FeatureInfo, ...]


def load_cluster_catalog_selection(path: Path) -> ClusterCatalogSelection:
    """Load the scientific-owner-approved legacy cluster catalog."""
    path = path.resolve()
    try:
        document = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"cannot load cluster catalog selection {path}") from error
    selection_schema = document.get("schema")
    if selection_schema not in {
        "ibl-cluster-catalog-selection-v1",
        "ibl-cluster-catalog-selection-v2",
    }:
        raise ValueError("unsupported cluster catalog selection schema")
    if document.get("scientific_owner_confirmation") is not True:
        raise ValueError(
            "cluster catalog selection lacks scientific-owner confirmation"
        )
    try:
        source = document["source"]
        table = source["table"]
        legacy = document["legacy_project_repository"]
        raw_features = document["features"]
    except (KeyError, TypeError) as error:
        raise ValueError("cluster catalog selection is incomplete") from error
    if not isinstance(raw_features, list) or not raw_features:
        raise ValueError("cluster catalog selection must contain features")
    features: list[FeatureInfo] = []
    for item in raw_features:
        try:
            feature_id = item["id"]
            info = FeatureInfo(
                source_column=item["source_column"],
                label=item["label"],
                description=item["description"],
                unit=item["unit"],
            )
        except (KeyError, TypeError) as error:
            raise ValueError(
                "cluster catalog selection has an incomplete feature"
            ) from error
        if (
            not isinstance(feature_id, str)
            or not feature_id
            or info.source_column != feature_id
        ):
            raise ValueError("cluster catalog feature ids must match source columns")
        if not all(
            isinstance(value, str) and value for value in (info.label, info.description)
        ):
            raise ValueError(
                f"cluster catalog feature {feature_id} lacks display metadata"
            )
        if info.unit is not None and not isinstance(info.unit, str):
            raise ValueError(
                f"cluster catalog feature {feature_id} has an invalid unit"
            )
        features.append(info)
    feature_ids = [feature.source_column for feature in features]
    if len(set(feature_ids)) != len(feature_ids):
        raise ValueError("cluster catalog selection contains duplicate features")
    for name, value in (
        ("table SHA-256", table.get("sha256")),
        ("legacy feature-source SHA-256", legacy.get("feature_source_sha256")),
        ("legacy unit-source SHA-256", legacy.get("unit_source_sha256")),
    ):
        if not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{64}", value):
            raise ValueError(f"cluster catalog selection has an invalid {name}")
    if not isinstance(table.get("bytes"), int) or table["bytes"] < 1:
        raise ValueError("cluster catalog selection has an invalid source table size")
    commit = legacy.get("commit")
    if not isinstance(commit, str) or not _COMMIT_RE.fullmatch(commit):
        raise ValueError(
            "cluster catalog selection has an invalid legacy repository commit"
        )
    return ClusterCatalogSelection(
        path=path,
        sha256=sha256_file(path),
        source_release_id=source["release_id"],
        project=source["project"],
        table_path=table["path"],
        table_bytes=table["bytes"],
        table_sha256=table["sha256"],
        legacy_repository=legacy["repository"],
        legacy_commit=commit,
        legacy_feature_source_path=legacy["feature_source_path"],
        legacy_feature_source_sha256=legacy["feature_source_sha256"],
        legacy_unit_source_path=legacy["unit_source_path"],
        legacy_unit_source_sha256=legacy["unit_source_sha256"],
        features=tuple(features),
    )


def apply_cluster_catalog_selection(
    config: ClusterBuildConfig, selection: ClusterCatalogSelection
) -> ClusterBuildConfig:
    """Bind a build to the exact source and catalog approved by the owner."""
    if config.source_release_id is not None and config.source_release_id != selection.source_release_id:
        raise ValueError(
            "cluster catalog selection source release does not match the build"
        )
    if config.project != selection.project:
        raise ValueError("cluster catalog selection project does not match the build")
    feature_ids = tuple(feature.source_column for feature in selection.features)
    if config.features is not None and tuple(config.features) != feature_ids:
        raise ValueError(
            "explicit cluster features do not exactly match the approved catalog"
        )
    return replace(
        config,
        source_release_id=selection.source_release_id,
        features=feature_ids,
    )


def build_clusters_release_from_arrays(
    release_dir: Path,
    config: ClusterBuildConfig,
    feature_values: Mapping[str, np.ndarray],
    parcellation_ids: Mapping[str, np.ndarray],
    region_metadata: Mapping[str, Mapping[int, RegionInfo]],
    provenance_sources: Sequence[dict],
    feature_metadata: Mapping[str, FeatureInfo] | None = None,
    feature_display: Mapping[str, dict] | None = None,
) -> Path:
    """Build regional summaries with one equal-weight observation per cluster."""
    config.validate()
    release_dir = release_dir.resolve()
    if release_dir.exists() and any(release_dir.iterdir()):
        raise ValueError(f"release directory is not empty: {release_dir}")
    release_dir.mkdir(parents=True, exist_ok=True)

    if not feature_values:
        raise ValueError("at least one cluster feature is required")
    missing_parcellations = [
        p for p in config.parcellations if p not in parcellation_ids
    ]
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
    feature_display = feature_display or {}
    features = []
    for feature_id in sorted(feature_values):
        values = np.asarray(feature_values[feature_id], dtype=np.float64)
        raw_display = feature_display.get(feature_id, {})
        display = validate_scalar_display(raw_display or linear_full_display(), values)
        feature_root = release_dir / "features" / feature_id
        regional = [
            write_feature_parcellation(
                feature_root,
                parcellation,
                values,
                group_rows[parcellation],
                config.histogram_bins,
                population_description,
                distribution_display=display,
            )
            for parcellation in config.parcellations
        ]
        info = feature_metadata.get(feature_id)
        source_column = info.source_column if info else feature_id
        feature_doc = {
            "schema_version": "1.0",
            "id": feature_id,
            "label": info.label if info else feature_id.replace("_", " "),
            "description": info.description
            if info
            else f"Cluster feature {source_column} aggregated regionally over all finite clusters.",
            "unit": info.unit if info else None,
            "display": {"regional": display},
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
                    "format": "ephys-atlas-regional-v1",
                    "parcellations": regional,
                }
            },
            "artifacts": [],
        }
        feature_path = feature_root / "feature.json"
        write_json(feature_path, feature_doc)
        features.append(
            {
                "id": feature_id,
                "descriptor": json_resource(
                    feature_path, release_dir, "ephys-atlas-feature-v1"
                ),
            }
        )

    scientific_sources = []
    for description, repository, commit in (
        (
            "ephysatlas cluster table schema and cell feature definitions",
            "int-brain-lab/ibleatools",
            config.ibleatools_commit,
        ),
        (
            "IBL atlas parcellation mappings",
            "int-brain-lab/iblatlas",
            config.iblatlas_commit,
        ),
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
        "schema_version": "1.0",
        "dataset_id": DATASET_ID,
        "title": "IBL Ephys Atlas — Cluster Features",
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
                "version": "1.0.0",
                "repository": "rossant/ibl-ephys-atlas-web-v2",
                **({"commit": config.builder_commit} if config.builder_commit else {}),
                "command": _builder_command(config),
                "environment": build_environment(),
            },
            "recipe": {
                "id": "ephys-atlas-clusters-regional-v1",
                "project": config.project,
                "population": "all",
                "parcellations": list(config.parcellations),
                "features": sorted(feature_values),
                **(
                    {"distribution_selection_sha256": sha256_file(config.distribution_selection)}
                    if config.distribution_selection is not None
                    else {}
                ),
                **(
                    {"catalog_selection_sha256": sha256_file(config.catalog_selection)}
                    if config.catalog_selection is not None
                    else {}
                ),
                "regional_summary": "arithmetic mean of all finite clusters in each region",
                "regional_statistics": [
                    "count",
                    "missing_count",
                    "min",
                    "max",
                    "mean",
                    "std",
                    "median",
                    "q05",
                    "q25",
                    "q75",
                    "q95",
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


def _verify_approved_cluster_table(
    source_snapshot: Path,
    project_dir: Path,
    selection: ClusterCatalogSelection,
) -> Path:
    table_path = source_snapshot / selection.table_path
    if table_path != project_dir / "cells_aggregates/clusters.table.pqt":
        raise RuntimeError(
            "approved cluster table path does not match the discovered project"
        )
    if table_path.stat().st_size != selection.table_bytes:
        raise RuntimeError("approved cluster table byte size does not match the source")
    if sha256_file(table_path) != selection.table_sha256:
        raise RuntimeError("approved cluster table SHA-256 does not match the source")
    return table_path


def _cluster_scientific_inputs(
    source_snapshot: Path,
    config: ClusterBuildConfig,
    selection: ClusterCatalogSelection,
):
    try:
        import pandas as pd
        import ephysatlas.anatomy
        import ephysatlas.cells
    except ImportError as exc:
        raise RuntimeError(
            "building cluster releases requires current ibleatools/ephysatlas, pandas, and iblatlas"
        ) from exc

    project_dir = discover_cluster_project_dir(source_snapshot)
    table_path = _verify_approved_cluster_table(source_snapshot, project_dir, selection)
    frame = pd.read_parquet(table_path)
    frame = pd.DataFrame(ephysatlas.cells.ModelClusters(frame))
    if "atlas_id" not in frame.columns:
        raise RuntimeError("cluster table has no atlas_id column")

    config.require_feature_catalog()
    assert config.features is not None
    requested = list(config.features)
    missing = [feature for feature in requested if feature not in frame.columns]
    if missing:
        raise RuntimeError(
            f"requested cluster features are missing: {', '.join(missing)}"
        )
    features = [feature for feature in requested if feature in frame.columns]
    if not features:
        raise RuntimeError("no canonical scalar cluster features are present")

    feature_values = {
        feature: frame[feature].to_numpy(dtype=np.float64, copy=False)
        for feature in features
    }
    selected_metadata = {
        feature.source_column: feature for feature in selection.features
    }
    feature_metadata = {feature: selected_metadata[feature] for feature in features}

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
        for region_id, acronym, name in zip(
            atlas.regions.id, atlas.regions.acronym, atlas.regions.name
        )
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
    if config.catalog_selection is None:
        raise ValueError(
            "snapshot builds require an approved cluster catalog selection"
        )
    if config.distribution_selection is None:
        raise ValueError(
            "snapshot builds require an approved D050 distribution selection"
        )
    catalog_selection = load_cluster_catalog_selection(config.catalog_selection)
    config = apply_cluster_catalog_selection(config, catalog_selection)
    distribution_selection = load_distribution_selection(
        config.distribution_selection,
        dataset_id=DATASET_ID,
        representation="regional",
    )
    config.validate()
    config.require_scientific_pins()
    config.require_feature_catalog()
    source_json = source_snapshot / "source.json"
    if not source_json.is_file():
        raise RuntimeError(f"missing source snapshot metadata: {source_json}")
    source = json.loads(source_json.read_text())
    if source.get("dataset_id") != DATASET_ID:
        raise RuntimeError(
            f"source snapshot is not {DATASET_ID}: {source.get('dataset_id')}"
        )
    if str(source.get("resolved_release")) != config.source_release_id:
        raise RuntimeError(
            f"source release {source.get('resolved_release')} does not match requested source release {config.source_release_id}"
        )
    if source.get("project") != config.project:
        raise RuntimeError(
            f"source project {source.get('project')} does not match requested project {config.project}"
        )
    source_files = {item.get("path"): item for item in source.get("files", [])}
    source_table = source_files.get(catalog_selection.table_path)
    if source_table != {
        "path": catalog_selection.table_path,
        "bytes": catalog_selection.table_bytes,
        "sha256": catalog_selection.table_sha256,
    }:
        raise RuntimeError(
            "source snapshot manifest does not match the approved cluster table"
        )

    canonical = source.get("canonical_source") or {}
    provenance_sources = [
        {
            "role": "canonical-data",
            "description": "Content-addressed ephysatlas all-cluster snapshot",
            "release": config.source_release_id,
            **({"uri": canonical["uri"]} if canonical.get("uri") else {}),
        },
        {
            "role": "publication-input",
            "description": "Checksummed source snapshot manifest used by the builder",
            "path": "source.json",
            "sha256": sha256_file(source_json),
        },
        {
            "role": "selection-freeze",
            "description": "Scientific-owner-approved legacy cluster feature catalog and metadata",
            "repository": "rossant/ibl-ephys-atlas-web-v2",
            "path": "catalog-selection.json",
            "sha256": catalog_selection.sha256,
        },
        selection_provenance(distribution_selection),
        {
            "role": "scientific-code",
            "description": "Legacy website cluster feature catalog and unit metadata",
            "repository": catalog_selection.legacy_repository,
            "commit": catalog_selection.legacy_commit,
        },
    ]
    inputs = _cluster_scientific_inputs(source_snapshot, config, catalog_selection)
    feature_display = bind_distribution_selection(
        distribution_selection,
        source_release_id=str(config.source_release_id),
        feature_ids=sorted(inputs[0]),
    )
    result = build_clusters_release_from_arrays(
        release_dir,
        config,
        *inputs[:3],
        provenance_sources,
        inputs[3],
        feature_display,
    )
    shutil.copyfile(source_json, result / "source.json")
    shutil.copyfile(catalog_selection.path, result / "catalog-selection.json")
    shutil.copyfile(
        distribution_selection.path, result / "distribution-selection.json"
    )
    return result
