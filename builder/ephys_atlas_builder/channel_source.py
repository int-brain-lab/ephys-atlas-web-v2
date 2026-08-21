from __future__ import annotations

from pathlib import Path
from typing import Sequence

import numpy as np

from .regional_release import FeatureInfo, RegionInfo, fold_region_ids_left

PARCELLATION_COLUMNS = {
    "allen": "Allen_id",
    "beryl": "Beryl_id",
    "cosmos": "Cosmos_id",
}


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
    """Load one source variant without ephysatlas' unconditional alpha mutation."""
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
        raise RuntimeError("channel_labels or labels not found in the merged channel source")

    aids = atlas.get_labels(frame.loc[:, ["x", "y", "z"]].values, mode="clip")
    frame["Allen_id"] = aids
    for mapping in ("Beryl", "Cosmos"):
        frame[f"{mapping}_id"] = atlas.regions.remap(aids, "Allen", mapping)
    return frame


def _feature_info(model, source_column: str, variant: str) -> FeatureInfo:
    column = model.to_schema().columns.get(source_column)
    metadata = getattr(column, "metadata", None) or {}
    label = metadata.get("label") or source_column.replace("_", " ")
    description = getattr(column, "description", None) or f"Channel feature {source_column}"
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


def load_channel_scientific_inputs(
    source_snapshot: Path,
    *,
    feature_mode: str,
    population: str,
    parcellations: Sequence[str],
    features: Sequence[str] | None,
):
    """Resolve canonical scientific channel inputs without release serialization."""
    try:
        import ephysatlas.anatomy
        import ephysatlas.features
    except ImportError as exc:
        raise RuntimeError(
            "building channel releases requires current ibleatools/ephysatlas and its scientific dependencies"
        ) from exc

    table_dir = discover_channel_table_dir(source_snapshot, feature_mode)
    atlas = ephysatlas.anatomy.ClassifierAtlas()
    requested = (
        sorted(set(ephysatlas.features.voltage_features_set()))
        if features is None
        else list(features)
    )
    modes = ("raw", "denoised") if feature_mode == "both" else (feature_mode,)
    frames = {}
    for mode in modes:
        frame = _read_channel_frame(table_dir, mode, atlas)
        if population == "inside":
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
        if features is not None and missing:
            raise RuntimeError(
                f"requested {mode} channel features are missing: {', '.join(missing)}"
            )
        available = [feature for feature in requested if feature in frame.columns]
        if not available:
            raise RuntimeError(
                f"no canonical channel features are present in the {mode} source table"
            )
        for feature in available:
            output_id = f"{feature}.{mode}" if feature_mode == "both" else feature
            feature_values[output_id] = frame[feature].to_numpy(
                dtype=np.float64,
                copy=False,
            )
            feature_metadata[output_id] = _feature_info(
                ephysatlas.features.ModelRawFeatures,
                feature,
                mode,
            )

    parcellation_ids = {
        parcellation: reference[PARCELLATION_COLUMNS[parcellation]].to_numpy(copy=False)
        for parcellation in parcellations
    }
    atlas_lookup = {
        int(region_id): RegionInfo(int(region_id), str(acronym), str(name))
        for region_id, acronym, name in zip(
            atlas.regions.id,
            atlas.regions.acronym,
            atlas.regions.name,
        )
    }
    region_metadata = {}
    for parcellation in parcellations:
        ids = fold_region_ids_left(parcellation_ids[parcellation])
        unique = sorted({int(value) for value in ids[np.isfinite(ids)]})
        region_metadata[parcellation] = {
            region_id: atlas_lookup.get(region_id, atlas_lookup.get(abs(region_id)))
            for region_id in unique
            if region_id in atlas_lookup or abs(region_id) in atlas_lookup
        }
    return feature_values, parcellation_ids, region_metadata, feature_metadata
