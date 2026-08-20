from __future__ import annotations

import json
import re
import shutil
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path

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
_COMMIT_RE = re.compile(r"^[0-9a-f]{7,40}$")


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
            raise ValueError(
                "created_at is required for deterministic release metadata"
            )
        if self.histogram_bins < 2:
            raise ValueError("histogram_bins must be >= 2")
        unknown = sorted(set(self.parcellations) - set(_PARCELLATION_COLUMNS))
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


@dataclass(frozen=True)
class RegionInfo:
    atlas_id: int
    acronym: str
    name: str


@dataclass(frozen=True)
class FeatureInfo:
    source_column: str
    label: str
    description: str
    unit: str | None = None
    variant: str | None = None


def fold_region_ids_left(region_ids: np.ndarray) -> np.ndarray:
    """Validate atlas identifiers and fold both hemispheres onto the left.

    IBL atlas identifiers encode hemisphere by sign. The public atlas viewer is
    intentionally a left-hemisphere view, so observations from either side are
    grouped under the corresponding negative identifier. Missing identifiers
    remain NaN and are excluded from regional groups.
    """
    ids = np.asarray(region_ids, dtype=np.float64)
    finite = np.isfinite(ids)
    finite_ids = ids[finite]
    if np.any(finite_ids != np.trunc(finite_ids)):
        raise ValueError("region ids must be integral numbers")
    if np.any(np.abs(finite_ids) > np.iinfo(np.int32).max):
        raise ValueError("region ids must fit in signed int32 after hemisphere folding")
    folded = ids.copy()
    folded[finite] = -np.abs(finite_ids)
    return folded


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
    ids = fold_region_ids_left(region_ids)
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
        groups.append(sorted_rows[int(start) : stop])
    return unique.astype(np.int32), groups


def _region_info(
    metadata: Mapping[int, RegionInfo], region_id: int
) -> RegionInfo | None:
    """Resolve metadata supplied in either lateralized or non-lateralized form."""
    return (
        metadata.get(region_id)
        or metadata.get(abs(region_id))
        or metadata.get(-abs(region_id))
    )


def _write_parcellation(
    release_dir: Path,
    parcellation: str,
    region_ids: np.ndarray,
    metadata: Mapping[int, RegionInfo],
) -> tuple[dict, list[np.ndarray]]:
    ids, groups = _group_indices(region_ids)
    if ids.size == 0:
        raise ValueError(
            f"{parcellation} has no finite region ids in the selected population"
        )

    missing = [
        int(region_id)
        for region_id in ids
        if _region_info(metadata, int(region_id)) is None
    ]
    if missing:
        preview = ", ".join(map(str, missing[:8]))
        raise ValueError(f"{parcellation} metadata is missing region ids: {preview}")

    root = release_dir / "parcellations" / parcellation
    index_meta = write_array(root / "region_ids.i32", ids, "int32")
    index_meta["path"] = f"parcellations/{parcellation}/region_ids.i32"
    regions = []
    for index, region_id in enumerate(ids):
        info = _region_info(metadata, int(region_id))
        assert info is not None
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
    regional_means = matrix[:, mean_index]
    finite_means = regional_means[np.isfinite(regional_means)]
    float32_max = np.finfo(np.float32).max
    values_dtype = (
        "float64"
        if finite_means.size and np.any(np.abs(finite_means) > float32_max)
        else "float32"
    )
    regional_values = regional_means.astype(
        np.float64 if values_dtype == "float64" else np.float32
    )
    suffix = "f64" if values_dtype == "float64" else "f32"
    values_meta = write_array(
        feature_root / f"{parcellation}.values.{suffix}",
        regional_values,
        values_dtype,
    )

    summary_meta = write_array(
        feature_root / f"{parcellation}.summary.f64", matrix, "float64"
    )
    regional_histogram = np.stack(
        [histogram(group, histogram_edges) for group in grouped_values]
    )
    histogram_meta = write_array(
        feature_root / f"{parcellation}.hist.u32", regional_histogram, "uint32"
    )

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
    feature_metadata: Mapping[str, FeatureInfo] | None = None,
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
    feature_metadata = feature_metadata or {}
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
        info = feature_metadata.get(feature_id)
        source_column = info.source_column if info else feature_id
        variant = (
            info.variant
            if info
            else (config.feature_mode if config.feature_mode != "both" else None)
        )
        variant_label = f" ({variant})" if variant else ""
        feature_doc = {
            "schema_version": "0.1",
            "id": feature_id,
            "label": info.label if info else feature_id.replace("_", " "),
            "description": (
                info.description
                if info
                else f"Channel feature {source_column}{variant_label} aggregated regionally by arithmetic mean."
            ),
            "unit": info.unit if info else None,
            "value_semantics": {
                "quantity": source_column,
                "transform": (
                    "identity from the selected source parquet; no outlier replacement or value clipping"
                ),
                "source_population": population_description,
                "missing_values": "non-finite observations are excluded from summaries and histograms",
                "source_column": source_column,
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
        features.append(
            {"id": feature_id, "path": f"features/{feature_id}/feature.json"}
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
            "sources": [*provenance_sources, *scientific_sources],
            "builder": {
                "name": "ibl-ephys-atlas-builder",
                "version": "0.1.0",
                "repository": "rossant/ibl-ephys-atlas-web-v2",
                **({"commit": config.builder_commit} if config.builder_commit else {}),
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


def discover_channel_table_dir(source_snapshot: Path, feature_mode: str) -> Path:
    if feature_mode not in {"raw", "denoised", "both"}:
        raise ValueError("feature_mode must be raw, denoised, or both")
    wanted = {
        "raw": ("raw_ephys_features.pqt",),
        "denoised": ("raw_ephys_features_denoised.pqt",),
        "both": ("raw_ephys_features.pqt", "raw_ephys_features_denoised.pqt"),
    }[feature_mode]
    candidates = sorted(
        path.parent
        for path in source_snapshot.rglob(wanted[0])
        if (path.parent / "channels.pqt").is_file()
        and all((path.parent / filename).is_file() for filename in wanted)
    )
    if len(candidates) != 1:
        raise RuntimeError(
            f"expected exactly one channel table directory containing {', '.join(wanted)} and channels.pqt; "
            f"found {len(candidates)}"
        )
    return candidates[0]


def _read_channel_frame(table_dir: Path, feature_mode: str, atlas):
    """Load one source variant without ibleatools' unconditional alpha mutation."""
    import pandas as pd

    filename = (
        "raw_ephys_features.pqt"
        if feature_mode == "raw"
        else "raw_ephys_features_denoised.pqt"
    )
    frame = pd.read_parquet(table_dir / filename)
    channels = pd.read_parquet(table_dir / "channels.pqt")
    duplicate_columns = set(frame.columns).intersection(channels.columns)
    frame = frame.merge(
        channels.drop(columns=list(duplicate_columns)),
        how="inner",
        right_index=True,
        left_index=True,
    )
    if "channel_labels" not in frame.columns and "labels" not in frame.columns:
        labels_path = table_dir / "channels_labels.pqt"
        if not labels_path.is_file():
            raise RuntimeError(
                "channel source has neither channel_labels/labels nor channels_labels.pqt"
            )
        frame = frame.merge(
            pd.read_parquet(labels_path).fillna(0),
            how="inner",
            right_index=True,
            left_index=True,
        )
    if "channel_labels" in frame.columns:
        frame["outside"] = frame["channel_labels"] == 3
    elif "labels" in frame.columns:
        frame["outside"] = frame["labels"] == 3
    else:
        raise RuntimeError(
            "channel_labels or labels not found in the merged channel source"
        )

    aids = atlas.get_labels(frame.loc[:, ["x", "y", "z"]].values, mode="clip")
    frame["Allen_id"] = aids
    for mapping in ("Beryl", "Cosmos"):
        frame[f"{mapping}_id"] = atlas.regions.remap(aids, "Allen", mapping)

    # Do not pass the complete table through ModelRawFeatures here. The canonical
    # snapshots contain legitimate per-feature nulls (for example alpha_mean),
    # while that model declares every inherited feature non-nullable. Validation
    # would therefore impose a global complete-case population before the recipe
    # can apply its documented per-feature finite-value selection. The requested
    # feature catalog is checked below and conversion to float64 provides the
    # relevant scalar/type validation without mutating or imputing source values.
    return frame


def _feature_info(model, source_column: str, variant: str) -> FeatureInfo:
    column = model.to_schema().columns.get(source_column)
    metadata = getattr(column, "metadata", None) or {}
    label = metadata.get("label") or source_column.replace("_", " ")
    description = (
        getattr(column, "description", None) or f"Channel feature {source_column}"
    )
    unit = (
        metadata.get("transformed_unit")
        or metadata.get("raw_unit")
        or metadata.get("unit")
    )
    if unit in {"N/A", "n/a", ""}:
        unit = None
    return FeatureInfo(
        source_column=source_column,
        label=f"{label} ({variant})",
        description=f"{description} Source variant: {variant}.",
        unit=unit,
        variant=variant,
    )


def _scientific_inputs(source_snapshot: Path, config: ChannelBuildConfig):
    try:
        import ephysatlas.anatomy
        import ephysatlas.features
    except ImportError as exc:
        raise RuntimeError(
            "building channel releases requires current ibleatools/ephysatlas and its scientific dependencies"
        ) from exc

    table_dir = discover_channel_table_dir(source_snapshot, config.feature_mode)
    atlas = ephysatlas.anatomy.ClassifierAtlas()
    if config.features is None:
        requested = sorted(set(ephysatlas.features.voltage_features_set()))
    else:
        requested = list(config.features)
    modes = (
        ("raw", "denoised") if config.feature_mode == "both" else (config.feature_mode,)
    )
    frames = {}
    for mode in modes:
        frame = _read_channel_frame(table_dir, mode, atlas)
        if config.population == "inside":
            if "outside" not in frame.columns:
                raise RuntimeError(
                    "inside population requested but the channel table has no outside column"
                )
            frame = frame.loc[~frame["outside"].astype(bool)].copy()
        frames[mode] = frame
    reference = frames[modes[0]]
    for mode in modes[1:]:
        if not reference.index.equals(frames[mode].index):
            raise RuntimeError(
                "raw and denoised channel tables do not select identical channel rows"
            )

    feature_values = {}
    feature_metadata = {}
    for mode, frame in frames.items():
        missing = [feature for feature in requested if feature not in frame.columns]
        if config.features is not None and missing:
            raise RuntimeError(
                f"requested {mode} channel features are missing: {', '.join(missing)}"
            )
        features = [feature for feature in requested if feature in frame.columns]
        if not features:
            raise RuntimeError(
                f"no canonical channel features are present in the {mode} source table"
            )
        for feature in features:
            output_id = (
                f"{feature}.{mode}" if config.feature_mode == "both" else feature
            )
            feature_values[output_id] = frame[feature].to_numpy(
                dtype=np.float64, copy=False
            )
            feature_metadata[output_id] = _feature_info(
                ephysatlas.features.ModelRawFeatures,
                feature,
                mode,
            )
    parcellation_ids = {
        parcellation: reference[_PARCELLATION_COLUMNS[parcellation]].to_numpy(
            copy=False
        )
        for parcellation in config.parcellations
    }

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
        raise RuntimeError(
            f"source snapshot is not {DATASET_ID}: {source.get('dataset_id')}"
        )
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
    feature_values, parcellation_ids, region_metadata, feature_metadata = (
        _scientific_inputs(source_snapshot, config)
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
