from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Mapping, Sequence
import json

import numpy as np

from .io import sha256_file, write_array, write_json
from .statistics import SUMMARY_FIELDS, describe, histogram, summary_matrix


DATASET_ID = "ephys_atlas_channels"
DEFAULT_PARCELLATIONS = ("allen", "beryl", "cosmos")
_PARCELLATION_COLUMNS = {
    "allen": "Allen_id",
    "beryl": "Beryl_id",
    "cosmos": "Cosmos_id",
}


@dataclass(frozen=True)
class ChannelBuildConfig:
    release_id: str
    created_at: str
    feature_mode: str
    population: str
    parcellations: tuple[str, ...] = DEFAULT_PARCELLATIONS
    features: tuple[str, ...] | None = None
    histogram_bins: int = 50
    paper_snapshot: bool = False

    def validate(self) -> None:
        if self.feature_mode not in {"raw", "denoised"}:
            raise ValueError("feature_mode must be explicitly raw or denoised")
        if self.population not in {"all", "inside"}:
            raise ValueError("population must be explicitly all or inside")
        if not self.release_id:
            raise ValueError("release_id is required")
        if not self.created_at:
            raise ValueError("created_at is required for deterministic release metadata")
        if self.histogram_bins < 2:
            raise ValueError("histogram_bins must be >= 2")
        unknown = sorted(set(self.parcellations) - set(_PARCELLATION_COLUMNS))
        if unknown:
            raise ValueError(f"unsupported parcellations: {', '.join(unknown)}")
        if not self.parcellations:
            raise ValueError("at least one parcellation is required")


@dataclass(frozen=True)
class RegionInfo:
    atlas_id: int
    acronym: str
    name: str


def _histogram_edges(values: np.ndarray, bins: int) -> np.ndarray:
    finite = np.asarray(values, dtype=np.float64)
    finite = finite[np.isfinite(finite)]
    if finite.size == 0:
        return np.linspace(0.0, 1.0, bins + 1, dtype=np.float64)
    lo = float(finite.min())
    hi = float(finite.max())
    if not hi > lo:
        pad = max(abs(lo) * 1e-9, 1e-12)
        lo -= pad
        hi += pad
    return np.linspace(lo, hi, bins + 1, dtype=np.float64)


def _group_indices(region_ids: np.ndarray) -> tuple[np.ndarray, list[np.ndarray]]:
    ids = np.asarray(region_ids, dtype=np.float64)
    valid_rows = np.flatnonzero(np.isfinite(ids))
    if valid_rows.size == 0:
        return np.array([], dtype=np.int32), []
    valid_ids = ids[valid_rows].astype(np.int64)
    order = np.argsort(valid_ids, kind="stable")
    sorted_ids = valid_ids[order]
    sorted_rows = valid_rows[order]
    unique, starts = np.unique(sorted_ids, return_index=True)
    groups: list[np.ndarray] = []
    for index, start in enumerate(starts):
        stop = int(starts[index + 1]) if index + 1 < len(starts) else len(sorted_rows)
        groups.append(sorted_rows[int(start):stop])
    return unique.astype(np.int32), groups


def _write_parcellation(
    release_dir: Path,
    parcellation: str,
    region_ids: np.ndarray,
    metadata: Mapping[int, RegionInfo],
) -> tuple[dict, list[np.ndarray]]:
    ids, groups = _group_indices(region_ids)
    if ids.size == 0:
        raise ValueError(f"{parcellation} has no finite region ids in the selected population")

    missing = [int(region_id) for region_id in ids if int(region_id) not in metadata]
    if missing:
        preview = ", ".join(map(str, missing[:8]))
        raise ValueError(f"{parcellation} metadata is missing region ids: {preview}")

    root = release_dir / "parcellations" / parcellation
    index_meta = write_array(root / "region_ids.i32", ids, "int32")
    index_meta["path"] = f"parcellations/{parcellation}/region_ids.i32"
    regions = []
    for index, region_id in enumerate(ids):
        info = metadata[int(region_id)]
        regions.append(
            {
                "index": index,
                "atlas_id": int(region_id),
                "acronym": info.acronym,
                "name": info.name,
            }
        )
    write_json(root / "regions.json", regions)
    return {
        "id": parcellation,
        "region_index": index_meta,
        "metadata": f"parcellations/{parcellation}/regions.json",
    }, groups


def _write_feature_parcellation(
    feature_root: Path,
    parcellation: str,
    values: np.ndarray,
    groups: Sequence[np.ndarray],
    histogram_edges: np.ndarray,
    population_description: str,
) -> dict:
    grouped_values = [values[rows] for rows in groups]
    matrix = summary_matrix(grouped_values)
    mean_index = SUMMARY_FIELDS.index("mean")
    regional_values = matrix[:, mean_index].astype(np.float32)
    values_meta = write_array(feature_root / f"{parcellation}.values.f32", regional_values, "float32")

    summary_meta = write_array(feature_root / f"{parcellation}.summary.f64", matrix, "float64")
    regional_histogram = np.stack([histogram(group, histogram_edges) for group in grouped_values])
    histogram_meta = write_array(feature_root / f"{parcellation}.hist.u32", regional_histogram, "uint32")

    stats = {
        "format": "ephys-atlas-statistics-v0.1",
        "population": population_description,
        "global": describe(values),
        "regional_summary": {"fields": SUMMARY_FIELDS, "values": summary_meta},
        "histogram": {
            "edges": histogram_edges.tolist(),
            "global_counts": histogram(values, histogram_edges).astype(int).tolist(),
            "regional_counts": histogram_meta,
            "bin_rule": "left-closed-right-open-last-closed",
        },
    }
    write_json(feature_root / f"{parcellation}.statistics.json", stats)
    return {
        "parcellation_id": parcellation,
        "summary": "mean",
        "values": values_meta,
        "statistics": f"{parcellation}.statistics.json",
    }


def build_channels_release_from_arrays(
    release_dir: Path,
    config: ChannelBuildConfig,
    feature_values: Mapping[str, np.ndarray],
    parcellation_ids: Mapping[str, np.ndarray],
    region_metadata: Mapping[str, Mapping[int, RegionInfo]],
    provenance_sources: Sequence[dict],
) -> Path:
    """Build a schema-v0.1 regional channel release from already-selected arrays.

    This function contains no scientific source loading. The caller must make the
    raw/denoised and population choices explicitly and provide arrays resulting
    from those choices. That separation keeps the transform deterministic and
    makes it straightforward to test without private infrastructure.
    """
    config.validate()
    release_dir = release_dir.resolve()
    if release_dir.exists() and any(release_dir.iterdir()):
        raise ValueError(f"release directory is not empty: {release_dir}")
    release_dir.mkdir(parents=True, exist_ok=True)

    if not feature_values:
        raise ValueError("at least one feature is required")
    lengths = {len(np.asarray(values)) for values in feature_values.values()}
    lengths.update(len(np.asarray(parcellation_ids[p])) for p in config.parcellations)
    if len(lengths) != 1:
        raise ValueError("feature and parcellation arrays must have the same row count")

    parcellation_entries = []
    group_rows: dict[str, list[np.ndarray]] = {}
    for parcellation in config.parcellations:
        if parcellation not in parcellation_ids:
            raise ValueError(f"missing {parcellation} region ids")
        metadata = region_metadata.get(parcellation)
        if metadata is None:
            raise ValueError(f"missing {parcellation} region metadata")
        entry, groups = _write_parcellation(
            release_dir,
            parcellation,
            np.asarray(parcellation_ids[parcellation]),
            metadata,
        )
        parcellation_entries.append(entry)
        group_rows[parcellation] = groups

    features = []
    population_description = (
        "all rows in the selected channel table"
        if config.population == "all"
        else "rows marked inside the atlas (outside == false)"
    )
    for feature_id in sorted(feature_values):
        values = np.asarray(feature_values[feature_id], dtype=np.float64)
        edges = _histogram_edges(values, config.histogram_bins)
        feature_root = release_dir / "features" / feature_id
        regional = []
        for parcellation in config.parcellations:
            regional.append(
                _write_feature_parcellation(
                    feature_root,
                    parcellation,
                    values,
                    group_rows[parcellation],
                    edges,
                    population_description,
                )
            )
        feature_doc = {
            "schema_version": "0.1",
            "id": feature_id,
            "label": feature_id.replace("_", " "),
            "description": f"Channel feature {feature_id} aggregated regionally by arithmetic mean.",
            "unit": None,
            "value_semantics": {
                "quantity": feature_id,
                "transform": "identity after upstream ephysatlas table loading",
                "source_population": population_description,
                "missing_values": "non-finite observations are excluded from summaries and histograms",
                "source_column": feature_id,
                "qc_filter": config.population,
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

    manifest = {
        "schema_version": "0.1",
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
            "sources": list(provenance_sources),
            "builder": {
                "name": "ibl-ephys-atlas-builder",
                "version": "0.1.0",
                "repository": "rossant/ibl-ephys-atlas-web-v2",
                "command": (
                    f"ephys-atlas-data build-channels {config.release_id} "
                    f"--feature-mode {config.feature_mode} --population {config.population}"
                ),
            },
            "recipe": {
                "id": "ephys-atlas-channels-regional-v0.1",
                "feature_mode": config.feature_mode,
                "population": config.population,
                "parcellations": list(config.parcellations),
                "features": sorted(feature_values),
                "regional_summary": "mean",
                "histogram_bins": config.histogram_bins,
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


def discover_channel_table_dir(source_snapshot: Path, feature_mode: str) -> Path:
    if feature_mode not in {"raw", "denoised"}:
        raise ValueError("feature_mode must be raw or denoised")
    wanted = "raw_ephys_features.pqt" if feature_mode == "raw" else "raw_ephys_features_denoised.pqt"
    candidates = sorted(
        path.parent
        for path in source_snapshot.rglob(wanted)
        if (path.parent / "channels.pqt").is_file()
    )
    if len(candidates) != 1:
        raise RuntimeError(
            f"expected exactly one channel table directory containing {wanted} and channels.pqt; found {len(candidates)}"
        )
    return candidates[0]


def _scientific_inputs(source_snapshot: Path, config: ChannelBuildConfig):
    try:
        import ephysatlas.anatomy
        import ephysatlas.data
        import ephysatlas.features
    except ImportError as exc:
        raise RuntimeError(
            "building channel releases requires current ibleatools/ephysatlas and its scientific dependencies"
        ) from exc

    table_dir = discover_channel_table_dir(source_snapshot, config.feature_mode)
    atlas = ephysatlas.anatomy.ClassifierAtlas()
    frame = ephysatlas.data.read_features_from_disk(
        table_dir,
        brain_atlas=atlas,
        mappings=["Beryl", "Cosmos"],
        strict=True,
        load_denoised=config.feature_mode == "denoised",
    )
    if config.population == "inside":
        if "outside" not in frame.columns:
            raise RuntimeError("inside population requested but the channel table has no outside column")
        frame = frame.loc[~frame["outside"].astype(bool)].copy()

    if config.features is None:
        requested = sorted(set(ephysatlas.features.voltage_features_set()))
    else:
        requested = list(config.features)
    missing = [feature for feature in requested if feature not in frame.columns]
    if config.features is not None and missing:
        raise RuntimeError(f"requested channel features are missing: {', '.join(missing)}")
    features = [feature for feature in requested if feature in frame.columns]
    if not features:
        raise RuntimeError("no canonical channel features are present in the selected source table")

    feature_values = {feature: frame[feature].to_numpy(dtype=np.float64, copy=False) for feature in features}
    parcellation_ids = {
        parcellation: frame[_PARCELLATION_COLUMNS[parcellation]].to_numpy(copy=False)
        for parcellation in config.parcellations
    }

    atlas_lookup = {
        int(region_id): RegionInfo(int(region_id), str(acronym), str(name))
        for region_id, acronym, name in zip(atlas.regions.id, atlas.regions.acronym, atlas.regions.name)
    }
    region_metadata = {}
    for parcellation in config.parcellations:
        ids = np.asarray(parcellation_ids[parcellation], dtype=np.float64)
        unique = sorted({int(value) for value in ids[np.isfinite(ids)]})
        region_metadata[parcellation] = {
            region_id: atlas_lookup[region_id]
            for region_id in unique
            if region_id in atlas_lookup
        }
    return feature_values, parcellation_ids, region_metadata


def build_channels_from_snapshot(
    source_snapshot: Path,
    release_dir: Path,
    config: ChannelBuildConfig,
) -> Path:
    config.validate()
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
    feature_values, parcellation_ids, region_metadata = _scientific_inputs(source_snapshot, config)
    return build_channels_release_from_arrays(
        release_dir,
        config,
        feature_values,
        parcellation_ids,
        region_metadata,
        provenance_sources,
    )
