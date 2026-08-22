from __future__ import annotations

import json
import re
import shutil
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from .channel_source import (
    _feature_info,
    discover_channel_table_dir,
    load_channel_scientific_inputs,
)
from .io import json_resource, sha256_file, write_json
from .regional_release import (
    DEFAULT_PARCELLATIONS,
    FeatureInfo,
    RegionInfo,
    fold_region_ids_left,
    histogram_edges,
    write_feature_parcellation,
    write_parcellation,
)

DATASET_ID = "ephys_atlas_channels"
_COMMIT_RE = re.compile(r"^[0-9a-f]{7,40}$")


@dataclass(frozen=True)
class ChannelBuildConfig:
    release_id: str
    created_at: str
    feature_mode: str
    population: str
    parcellations: tuple[str, ...] = DEFAULT_PARCELLATIONS
    features: tuple[str, ...] | None = None
    log_color_features: tuple[str, ...] = ()
    histogram_bins: int = 50
    paper_snapshot: bool = False
    ibleatools_commit: str | None = None
    iblatlas_commit: str | None = None
    builder_commit: str | None = None

    def validate(self) -> None:
        if self.feature_mode not in {"raw", "denoised", "both"}:
            raise ValueError("feature_mode must be explicitly raw, denoised, or both")
        if self.population not in {"all", "inside"}:
            raise ValueError("population must be explicitly all or inside")
        if not self.release_id:
            raise ValueError("release_id is required")
        if not self.created_at:
            raise ValueError("created_at is required for deterministic release metadata")
        if self.histogram_bins < 2:
            raise ValueError("histogram_bins must be >= 2")
        unknown = sorted(set(self.parcellations) - set(DEFAULT_PARCELLATIONS))
        if unknown:
            raise ValueError(f"unsupported parcellations: {', '.join(unknown)}")
        if not self.parcellations:
            raise ValueError("at least one parcellation is required")
        if len(set(self.log_color_features)) != len(self.log_color_features):
            raise ValueError("log_color_features must not contain duplicates")
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


def build_channels_release_from_arrays(
    release_dir: Path,
    config: ChannelBuildConfig,
    feature_values: Mapping[str, np.ndarray],
    parcellation_ids: Mapping[str, np.ndarray],
    region_metadata: Mapping[str, Mapping[int, RegionInfo]],
    provenance_sources: Sequence[dict],
    feature_metadata: Mapping[str, FeatureInfo] | None = None,
) -> Path:
    """Build a schema-v1 regional channel release from already-selected arrays."""
    config.validate()
    release_dir = release_dir.resolve()
    if release_dir.exists() and any(release_dir.iterdir()):
        raise ValueError(f"release directory is not empty: {release_dir}")
    release_dir.mkdir(parents=True, exist_ok=True)

    if not feature_values:
        raise ValueError("at least one feature is required")
    unknown_log_features = sorted(set(config.log_color_features) - set(feature_values))
    if unknown_log_features:
        raise ValueError(f"log color features are not in the release catalog: {', '.join(unknown_log_features)}")
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

    population_description = (
        "all rows in the selected channel table"
        if config.population == "all"
        else "rows marked inside the atlas (outside == false)"
    )
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
            "schema_version": "1.0",
            "id": feature_id,
            "label": info.label if info else feature_id.replace("_", " "),
            "description": (
                info.description
                if info
                else f"Channel feature {source_column} aggregated regionally by arithmetic mean."
            ),
            "unit": info.unit if info else None,
            **({"display": {"scale": "log"}} if feature_id in config.log_color_features else {}),
            "value_semantics": {
                "quantity": source_column,
                "transform": "identity from the selected source parquet; no outlier replacement or value clipping",
                "source_population": population_description,
                "missing_values": "non-finite observations are excluded from summaries and histograms",
                "source_column": source_column,
                "qc_filter": config.population,
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
    if config.ibleatools_commit:
        scientific_sources.append(
            {
                "role": "scientific-code",
                "description": "ephysatlas channel table schema and feature catalog",
                "repository": "int-brain-lab/ibleatools",
                "commit": config.ibleatools_commit,
            }
        )
    if config.iblatlas_commit:
        scientific_sources.append(
            {
                "role": "scientific-code",
                "description": "IBL atlas coordinates and parcellation mappings",
                "repository": "int-brain-lab/iblatlas",
                "commit": config.iblatlas_commit,
            }
        )
    manifest = {
        "schema_version": "1.0",
        "dataset_id": DATASET_ID,
        "title": "IBL Ephys Atlas channel features",
        "description": "Regional descriptive summaries of channel-level ephys-atlas features.",
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
                "command": (
                    f"ephys-atlas-data build-channels {config.release_id} "
                    f"--feature-mode {config.feature_mode} --population {config.population}"
                ),
            },
            "recipe": {
                "id": "ephys-atlas-channels-regional-v1",
                "feature_mode": config.feature_mode,
                "population": config.population,
                "parcellations": list(config.parcellations),
                "features": sorted(feature_values),
                "log_color_features": sorted(config.log_color_features),
                "regional_summary": "mean",
                "histogram_bins": config.histogram_bins,
                "hemisphere": "bilateral observations folded onto left atlas ids using -abs(id)",
                "outlier_policy": "preserve source values; exclude only non-finite values from summaries",
            },
            "notes": [
                "The source feature list is resolved at build time; the browser must not hard-code it.",
                "Raw versus denoised input is an explicit build parameter because the paper example and current loader default are ambiguous.",
            ],
        },
        "parcellations": parcellation_entries,
        "features": features,
        "artifacts": [],
    }
    write_json(release_dir / "manifest.json", manifest)
    return release_dir


def build_channels_from_snapshot(
    source_snapshot: Path,
    release_dir: Path,
    config: ChannelBuildConfig,
) -> Path:
    config.validate()
    config.require_scientific_pins()
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

    canonical = source.get("canonical_source") or {}
    provenance_sources = [
        {
            "role": "canonical-data",
            "description": "Canonical ea_active channel feature snapshot",
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
    feature_values, parcellation_ids, region_metadata, feature_metadata = load_channel_scientific_inputs(
        source_snapshot,
        feature_mode=config.feature_mode,
        population=config.population,
        parcellations=config.parcellations,
        features=config.features,
    )
    result = build_channels_release_from_arrays(
        release_dir,
        config,
        feature_values,
        parcellation_ids,
        region_metadata,
        provenance_sources,
        feature_metadata,
    )
    shutil.copyfile(source_json, result / "source.json")
    return result
