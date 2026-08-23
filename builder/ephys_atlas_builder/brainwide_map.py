from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
import re
import subprocess

import numpy as np

from .io import json_resource, sha256_file, write_json
from .regional_release import (
    FeatureInfo,
    RegionInfo,
    fold_region_ids_left,
    histogram_edges,
    write_feature_parcellation,
    write_parcellation,
)


DATASET_ID = "brainwide_map"
LEGACY_GENERATOR_COMMIT = "1d908bea095be2616a750d939d143f3b4db2a641"
LEGACY_FAMILY_SOURCES = {
    "choice": (19742, "179bd6714bbb3e22f98fc4311c07a9a367d6ad8bf7487469108862751a2c3421"),
    "feedback": (20053, "262f48322b36f3655e76648aaa41db7a075387541a9403e52819523a56acf7f1"),
    "stimulus": (18892, "6ecd376ec9a81bf179a04bd250793fc8f254cd3e77ba93c4c63ba861e07d8efa"),
    "wheel_speed": (12371, "58b63dd36f7ce3e7615624d1e11e47906fae00eff717f08653f7e299f057a7ca"),
    "wheel_velocity": (12126, "5da2ee7ae0added6996a433fd8c04796d8953bac15612cd89f46d8fb56688438"),
}
LEGACY_REGION_SOURCE = (
    21865,
    "124dc20f137ebc4d47795e6ca53d0d8c7d71b03c0b2301851aa058ba854cfa50",
)
_COMMIT_RE = re.compile(r"^[0-9a-f]{7,40}$")


@dataclass(frozen=True)
class LegacyFamilyTable:
    region_ids: np.ndarray
    acronyms: tuple[str, ...]
    features: Mapping[str, np.ndarray]


@dataclass(frozen=True)
class BrainwideMapBuildConfig:
    release_id: str
    created_at: str
    histogram_bins: int = 50
    paper_snapshot: bool = False
    generator_commit: str = LEGACY_GENERATOR_COMMIT
    builder_commit: str | None = None

    def validate(self) -> None:
        if not self.release_id:
            raise ValueError("release_id is required")
        if not self.created_at:
            raise ValueError("created_at is required for deterministic release metadata")
        if self.histogram_bins < 2:
            raise ValueError("histogram_bins must be >= 2")
        if self.generator_commit != LEGACY_GENERATOR_COMMIT:
            raise ValueError(
                "generator_commit must identify the D038-pinned v1 website generator"
            )
        if self.builder_commit is not None and not _COMMIT_RE.fullmatch(
            self.builder_commit
        ):
            raise ValueError(
                "builder_commit must be a 7-40 character lowercase Git commit"
            )


def _legacy_boolean_values(values: np.ndarray) -> np.ndarray:
    """Reproduce v1's 0.5/1.0 encoding for boolean-like significance columns."""
    array = np.asarray(values)
    finite = array[np.isfinite(array)] if array.dtype.kind in "fiu" else array
    unique = set(np.asarray(finite).tolist())
    if unique <= {False, True}:
        transformed = np.where(
            np.asarray(array, dtype=bool),
            1.0,
            0.5,
        ).astype(np.float64)
        if array.dtype.kind == "f":
            transformed[~np.isfinite(array)] = np.nan
        return transformed
    return np.asarray(array, dtype=np.float64)


def _legacy_float(value: float) -> float:
    """Apply the pinned generator's six-significant-digit JSON value semantics."""
    return float(f"{value:.6g}")


def _aligned_groups(region_ids: np.ndarray, output_ids: np.ndarray) -> list[np.ndarray]:
    folded = fold_region_ids_left(region_ids)
    return [np.flatnonzero(folded == region_id) for region_id in output_ids]


def build_brainwide_map_release_from_tables(
    release_dir: Path,
    config: BrainwideMapBuildConfig,
    families: Mapping[str, LegacyFamilyTable],
    region_metadata: Mapping[int, RegionInfo],
    provenance_sources: Sequence[dict],
    feature_metadata: Mapping[str, FeatureInfo] | None = None,
) -> Path:
    """Preserve the D038-selected v1 Beryl regional snapshot in schema v1."""
    config.validate()
    if set(families) != set(LEGACY_FAMILY_SOURCES):
        raise ValueError(
            "brainwide_map requires exactly the five D038 legacy families"
        )
    release_dir = release_dir.resolve()
    if release_dir.exists() and any(release_dir.iterdir()):
        raise ValueError(f"release directory is not empty: {release_dir}")
    release_dir.mkdir(parents=True, exist_ok=True)

    all_ids: list[np.ndarray] = []
    for family, table in families.items():
        row_count = len(table.region_ids)
        if len(table.acronyms) != row_count or any(
            len(values) != row_count for values in table.features.values()
        ):
            raise ValueError(f"{family} columns must have the same row count")
        if not table.features:
            raise ValueError(f"{family} has no legacy feature columns")
        all_ids.append(fold_region_ids_left(table.region_ids))

    union_ids = np.unique(np.concatenate(all_ids)).astype(np.int32)
    parcellation_entry, _ = write_parcellation(
        release_dir, "beryl", union_ids, region_metadata
    )
    feature_metadata = feature_metadata or {}
    feature_entries = []
    for family in LEGACY_FAMILY_SOURCES:
        table = families[family]
        groups = _aligned_groups(table.region_ids, union_ids)
        for source_column in sorted(table.features):
            feature_id = f"{family}_{source_column}"
            transformed = _legacy_boolean_values(table.features[source_column])
            feature_root = release_dir / "features" / feature_id
            regional = write_feature_parcellation(
                feature_root,
                "beryl",
                transformed,
                groups,
                histogram_edges(transformed, config.histogram_bins),
                f"rows in the preserved legacy {family}_bwm.pqt regional table",
                numeric_transform=_legacy_float,
            )
            info = feature_metadata.get(feature_id)
            is_significance = source_column.endswith("_significant")
            feature_doc = {
                "schema_version": "1.0",
                "id": feature_id,
                "label": info.label if info else feature_id.replace("_", " "),
                "description": (
                    info.description
                    if info
                    else "Preserved legacy v1 Brain-Wide Map regional feature."
                ),
                "unit": info.unit if info else None,
                "value_semantics": {
                    "quantity": source_column,
                    "transform": (
                        "legacy boolean presentation: false=0.5, true=1.0; values serialized to six significant digits"
                        if is_significance
                        else "identity followed by the legacy generator's six-significant-digit serialization"
                    ),
                    "source_population": f"the checksummed {family}_bwm.pqt legacy website snapshot",
                    "missing_values": "non-finite source values are excluded from summaries and histograms",
                    "source_column": source_column,
                    "qc_filter": "none; preserve the already-produced legacy regional snapshot",
                },
                "representations": {
                    "regional": {
                        "format": "ephys-atlas-regional-v1",
                        "parcellations": [regional],
                    }
                },
                "artifacts": [],
            }
            feature_path = feature_root / "feature.json"
            write_json(feature_path, feature_doc)
            feature_entries.append(
                {
                    "id": feature_id,
                    "descriptor": json_resource(
                        feature_path, release_dir, "ephys-atlas-feature-v1"
                    ),
                }
            )

    manifest = {
        "schema_version": "1.0",
        "dataset_id": DATASET_ID,
        "title": "IBL Brain-Wide Map legacy website snapshot",
        "description": (
            "Preserved Beryl-only regional features from the v1 website; this is "
            "not a regeneration from a current Brain-Wide Map paper release."
        ),
        "release": {
            "release_id": config.release_id,
            "immutable": True,
            "created_at": config.created_at,
            "paper_snapshot": config.paper_snapshot,
        },
        "provenance": {
            "sources": [
                *provenance_sources,
                {
                    "role": "scientific-code",
                    "description": "Pinned v1 website Brain-Wide Map generator",
                    "repository": "int-brain-lab/ephys-atlas-web",
                    "commit": config.generator_commit,
                },
            ],
            "builder": {
                "name": "ibl-ephys-atlas-builder",
                "version": "1.0.0",
                "repository": "rossant/ibl-ephys-atlas-web-v2",
                **(
                    {"commit": config.builder_commit}
                    if config.builder_commit
                    else {}
                ),
                "command": f"ephys-atlas-data build-brainwide-map {config.release_id}",
            },
            "recipe": {
                "id": "brainwide-map-legacy-website-regional-v1",
                "families": list(LEGACY_FAMILY_SOURCES),
                "parcellations": ["beryl"],
                "features": [entry["id"] for entry in feature_entries],
                "regional_summary": "pinned v1 arithmetic mean after left lateralization",
                "significance_encoding": "false=0.5, true=1.0",
                "numeric_serialization": "six significant digits before schema-v1 packaging",
                "histogram_bins": config.histogram_bins,
            },
            "notes": [
                "This release preserves a legacy website snapshot and is not a current paper-pipeline regeneration."
            ],
        },
        "parcellations": [parcellation_entry],
        "features": feature_entries,
        "artifacts": [],
    }
    write_json(release_dir / "manifest.json", manifest)
    return release_dir


def verify_legacy_sources(source_dir: Path) -> dict[str, Path]:
    """Verify all D038 inputs before a Parquet reader can inspect their contents."""
    verified: dict[str, Path] = {}
    for family, (expected_bytes, expected_sha256) in LEGACY_FAMILY_SOURCES.items():
        path = source_dir / f"{family}_bwm.pqt"
        if not path.is_file():
            raise RuntimeError(f"missing legacy Brain-Wide Map source: {path}")
        if path.stat().st_size != expected_bytes:
            raise RuntimeError(f"legacy source byte-size mismatch: {path}")
        if sha256_file(path) != expected_sha256:
            raise RuntimeError(f"legacy source SHA-256 mismatch: {path}")
        verified[family] = path
    region_path = source_dir / "beryl_regions.pqt"
    expected_bytes, expected_sha256 = LEGACY_REGION_SOURCE
    if not region_path.is_file():
        raise RuntimeError(f"missing legacy Beryl region metadata: {region_path}")
    if region_path.stat().st_size != expected_bytes:
        raise RuntimeError(f"legacy region metadata byte-size mismatch: {region_path}")
    if sha256_file(region_path) != expected_sha256:
        raise RuntimeError(f"legacy region metadata SHA-256 mismatch: {region_path}")
    verified["beryl_regions"] = region_path
    return verified


def require_local_builder_commit(commit: str, repository_root: Path) -> None:
    """Reject a provenance pin that is not a commit in this builder checkout."""
    result = subprocess.run(
        ["git", "-C", str(repository_root), "cat-file", "-e", f"{commit}^{{commit}}"],
        check=False,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"builder_commit is not a commit in the local repository: {commit}"
        )


def _load_verified_tables(
    verified: Mapping[str, Path],
) -> tuple[dict[str, LegacyFamilyTable], dict[int, RegionInfo]]:
    try:
        import pandas as pd
    except ImportError as exc:
        raise RuntimeError(
            "building brainwide_map requires pandas and a Parquet engine from the scientific environment"
        ) from exc

    region_frame = pd.read_parquet(verified["beryl_regions"])
    required_region_columns = {"atlas_id", "acronym", "atlas_name"}
    if not required_region_columns <= set(region_frame.columns):
        raise RuntimeError("beryl_regions.pqt is missing required metadata columns")
    metadata: dict[int, RegionInfo] = {}
    for region_id, acronym, name in zip(
        region_frame["atlas_id"],
        region_frame["acronym"],
        region_frame["atlas_name"],
        strict=True,
    ):
        folded = -abs(int(region_id))
        if folded not in metadata or int(region_id) < 0:
            metadata[folded] = RegionInfo(folded, str(acronym), str(name))
    families = {}
    for family in LEGACY_FAMILY_SOURCES:
        frame = pd.read_parquet(verified[family])
        required = {"atlas_id_b", "acronym_b"}
        if not required <= set(frame.columns):
            raise RuntimeError(f"{family} is missing atlas_id_b or acronym_b")
        feature_columns = [
            column
            for column in frame.columns
            if not column.startswith(("atlas_id", "acronym", "pid"))
        ]
        if not feature_columns:
            raise RuntimeError(f"{family} has no legacy feature columns")
        region_ids = frame["atlas_id_b"].to_numpy(dtype=np.float64, copy=False)
        acronyms = tuple(str(value) for value in frame["acronym_b"])
        for region_id, acronym in zip(region_ids, acronyms, strict=True):
            folded = -abs(int(region_id))
            existing = metadata.get(folded)
            if existing is None:
                raise RuntimeError(
                    f"Beryl metadata is missing source atlas id {folded}"
                )
            if existing.acronym != acronym:
                raise RuntimeError(
                    f"conflicting Beryl acronym for atlas id {folded}: "
                    f"{existing.acronym} versus {acronym}"
                )
        families[family] = LegacyFamilyTable(
            region_ids=region_ids,
            acronyms=acronyms,
            features={
                column: frame[column].to_numpy(copy=False)
                for column in feature_columns
            },
        )
    return families, metadata


def build_brainwide_map_from_sources(
    source_dir: Path,
    release_dir: Path,
    config: BrainwideMapBuildConfig,
) -> Path:
    config.validate()
    if config.builder_commit is not None:
        require_local_builder_commit(
            config.builder_commit, Path(__file__).resolve().parents[2]
        )
    verified = verify_legacy_sources(source_dir)
    families, metadata = _load_verified_tables(verified)
    sources = [
        {
            "role": "canonical-data",
            "description": f"Preserved v1 website {family} Brain-Wide Map table",
            "path": path.name,
            "sha256": LEGACY_FAMILY_SOURCES[family][1],
        }
        for family, path in verified.items()
        if family in LEGACY_FAMILY_SOURCES
    ]
    sources.append(
        {
            "role": "atlas-geometry",
            "description": "Pinned v1 website Beryl region metadata",
            "path": verified["beryl_regions"].name,
            "sha256": LEGACY_REGION_SOURCE[1],
        }
    )
    return build_brainwide_map_release_from_tables(
        release_dir, config, families, metadata, sources
    )
