"""Explicit Allen regional inputs for the public authoring API."""

from __future__ import annotations

from dataclasses import dataclass
from importlib.metadata import PackageNotFoundError, version
from typing import Any, Sequence

import numpy as np

from ephys_atlas_builder.regional_release import RegionInfo


@dataclass(frozen=True)
class RegionalObservations:
    """One feature's source observations keyed by positive logical Allen ID."""

    logical_region_ids: np.ndarray
    values: np.ndarray
    metadata: dict[int, RegionInfo]
    input_kind: str
    aggregation: str
    hemisphere_policy: str
    iblatlas_version: str

    def groups_for(self, ordered_logical_ids: Sequence[int]) -> list[np.ndarray]:
        return [
            np.flatnonzero(self.logical_region_ids == region_id)
            for region_id in ordered_logical_ids
        ]


def _iblatlas_version() -> str:
    try:
        return version("iblatlas")
    except PackageNotFoundError:
        return "unknown"


def _require_brain_regions(ontology: Any) -> None:
    try:
        from iblatlas.regions import BrainRegions
    except ImportError as error:  # pragma: no cover - installation failure
        raise RuntimeError("regional authoring requires the iblatlas package") from error
    if not isinstance(ontology, BrainRegions):
        raise TypeError("ontology must be an iblatlas.regions.BrainRegions instance")


def _values(values: Any) -> np.ndarray:
    raw = np.asarray(values)
    if raw.ndim != 1:
        raise ValueError("regional values must be a one-dimensional array")
    if raw.dtype.kind in {"b", "c", "O", "S", "U", "V"}:
        raise TypeError("regional values must be real numeric scalars, not boolean or object values")
    try:
        result = raw.astype(np.float64, copy=False)
    except (TypeError, ValueError, OverflowError) as error:
        raise TypeError("regional values must be convertible to float64") from error
    frozen = np.array(result, dtype=np.float64, copy=True)
    frozen.setflags(write=False)
    return frozen


def _ids_from_numeric(region_ids: Any) -> np.ndarray:
    raw = np.asarray(region_ids)
    if raw.ndim != 1:
        raise ValueError("region_ids must be a one-dimensional array")
    if raw.dtype.kind in {"b", "c", "O", "S", "U", "V"}:
        raise TypeError("region_ids must contain integral numeric Allen IDs")
    numeric = raw.astype(np.float64, copy=False)
    if not np.isfinite(numeric).all() or np.any(numeric != np.trunc(numeric)):
        raise ValueError("region_ids must contain finite integral Allen IDs")
    if np.any(np.abs(numeric) > np.iinfo(np.int32).max):
        raise ValueError("region_ids must fit in signed int32")
    return numeric.astype(np.int64)


def _ids_from_acronyms(acronyms: Any, ontology: Any) -> np.ndarray:
    raw = np.asarray(acronyms, dtype=object)
    if raw.ndim != 1:
        raise ValueError("acronyms must be a one-dimensional array")
    resolved: list[int] = []
    for index, value in enumerate(raw.tolist()):
        if not isinstance(value, str) or not value:
            raise ValueError(f"acronyms[{index}] must be a nonempty string")
        matches = np.asarray(
            ontology.acronym2id([value], mapping="Allen"), dtype=np.int64
        ).reshape(-1)
        if matches.size != 1:
            raise ValueError(f"unknown or ambiguous Allen acronym: {value}")
        resolved.append(int(matches[0]))
    return np.asarray(resolved, dtype=np.int64)


def normalize_regional_input(
    *,
    values: Any,
    ontology: Any,
    region_ids: Any | None,
    acronyms: Any | None,
    source_mapping: str,
    output_mappings: Sequence[str],
    hemisphere_policy: str,
    aggregation: str,
    require_unique: bool,
) -> RegionalObservations:
    """Validate identities without inferring their type, mapping, or hemisphere."""
    _require_brain_regions(ontology)
    if (region_ids is None) == (acronyms is None):
        raise ValueError("provide exactly one of region_ids or acronyms")
    if source_mapping != "Allen":
        raise ValueError("the first regional authoring slice supports source_mapping='Allen' only")
    if tuple(output_mappings) != ("Allen",):
        raise ValueError("the first regional authoring slice supports output_mappings=('Allen',) only")
    if hemisphere_policy not in {"non_lateralized", "fold"}:
        raise ValueError("hemisphere_policy must be 'non_lateralized' or 'fold'")
    if aggregation != "mean":
        raise ValueError("the first regional observation aggregation is explicit mean only")

    numeric_values = _values(values)
    input_kind = "region_ids" if region_ids is not None else "acronyms"
    ids = (
        _ids_from_numeric(region_ids)
        if region_ids is not None
        else _ids_from_acronyms(acronyms, ontology)
    )
    if ids.size != numeric_values.size:
        raise ValueError("regional identities and values must have the same length")
    if ids.size == 0:
        raise ValueError("regional authoring requires at least one identity/value row")
    logical_ids = np.abs(ids)
    if np.any(np.isin(logical_ids, (0, 997))):
        raise ValueError("Allen void (0) and root (997) identities are unsupported")
    if hemisphere_policy == "non_lateralized" and np.any(ids <= 0):
        raise ValueError(
            "non-lateralized regional identities must be positive; use hemisphere_policy='fold' for signed IDs"
        )
    known = {int(item) for item in np.asarray(ontology.id) if int(item) > 0}
    unknown = sorted({int(item) for item in logical_ids if int(item) not in known})
    if unknown:
        raise ValueError(f"unknown Allen region IDs: {', '.join(map(str, unknown[:8]))}")
    if require_unique and np.unique(logical_ids).size != logical_ids.size:
        raise ValueError("add_region_values requires one value per folded logical Allen region")

    metadata: dict[int, RegionInfo] = {}
    for region_id in sorted({int(item) for item in logical_ids}):
        record = ontology.get(np.asarray([region_id], dtype=np.int64))
        returned_id = int(np.asarray(record.id).reshape(-1)[0])
        if returned_id != region_id:
            raise ValueError(f"iblatlas returned inconsistent metadata for Allen ID {region_id}")
        metadata[region_id] = RegionInfo(
            atlas_id=region_id,
            acronym=str(np.asarray(record.acronym).reshape(-1)[0]),
            name=str(np.asarray(record.name).reshape(-1)[0]),
        )

    frozen_ids = np.array(logical_ids, dtype=np.int64, copy=True)
    frozen_ids.setflags(write=False)
    return RegionalObservations(
        logical_region_ids=frozen_ids,
        values=numeric_values,
        metadata=metadata,
        input_kind=input_kind,
        aggregation=aggregation,
        hemisphere_policy=hemisphere_policy,
        iblatlas_version=_iblatlas_version(),
    )
