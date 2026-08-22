"""Deterministic structural and scientific metrics for smoothing candidates."""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass
from typing import Any

import numpy as np
import shapely
from shapely import coverage_is_valid, get_coordinates
from shapely.geometry import MultiPolygon, Polygon

from tools.anatomy_pack.geometry import (
    adjacency_pairs,
    boundary_errors,
    geometry_signature,
    internal_background_components,
    voxel_center_errors,
)

Geometry = Polygon | MultiPolygon


@dataclass(frozen=True)
class EvaluationPolicy:
    """Explicit provisional gates; these are experiment inputs, not policy."""

    maximum_error_um: float
    minimum_iou: float
    minimum_iou_area_um2: float

    def __post_init__(self) -> None:
        if not math.isfinite(self.maximum_error_um) or self.maximum_error_um < 0:
            raise ValueError("maximum_error_um must be finite and non-negative")
        if not math.isfinite(self.minimum_iou) or not 0 <= self.minimum_iou <= 1:
            raise ValueError("minimum_iou must be finite and between zero and one")
        if (
            not math.isfinite(self.minimum_iou_area_um2)
            or self.minimum_iou_area_um2 < 0
        ):
            raise ValueError("minimum_iou_area_um2 must be finite and non-negative")


@dataclass(frozen=True)
class RegionMetrics:
    label: int
    components_before: int
    components_after: int
    holes_before: int
    holes_after: int
    reference_area_um2: float
    candidate_area_um2: float
    area_change_um2: float
    relative_area_change: float
    iou: float


@dataclass(frozen=True)
class ExperimentMetrics:
    region_count: int
    components_before: int
    components_after: int
    holes_before: int
    holes_after: int
    coverage_valid_before: bool
    coverage_valid_after: bool
    geometries_valid_after: bool
    adjacency_count_before: int
    adjacency_count_after: int
    adjacency_preserved: bool
    uncovered_voxels: int
    multiply_covered_voxels: int
    wrong_label_voxels: int
    internal_background_components_before: int
    internal_background_components_after: int
    background_topology_valid: bool
    minimum_eligible_region_iou: float
    worst_iou_region: int | None
    median_boundary_error_um: float
    p95_boundary_error_um: float
    maximum_boundary_error_um: float
    maximum_boundary_error_upper_bound_um: float
    vertices_before: int
    vertices_after: int
    worst_absolute_area_change_region: int | None
    worst_relative_area_change_region: int | None
    regions: tuple[RegionMetrics, ...]
    failures: tuple[str, ...]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _label_adjacencies(
    labels: list[int], geometries: list[Geometry]
) -> set[tuple[int, int]]:
    return {
        tuple(sorted((labels[first], labels[second])))
        for first, second in adjacency_pairs(geometries)
    }


def measure_candidate(
    reference_by_label: dict[int, Geometry],
    candidate_by_label: dict[int, Geometry],
    *,
    source_plane: np.ndarray,
    resolution_um: int,
    policy: EvaluationPolicy,
) -> ExperimentMetrics:
    """Measure a candidate without discarding evidence when a gate fails."""
    if source_plane.ndim != 2:
        raise ValueError("source_plane must be two-dimensional")
    if resolution_um <= 0:
        raise ValueError("resolution_um must be positive")
    labels = sorted(reference_by_label)
    if sorted(candidate_by_label) != labels:
        raise ValueError("candidate label set must exactly match the reference")

    reference = [reference_by_label[label] for label in labels]
    candidate = [candidate_by_label[label] for label in labels]
    identical_objects = all(
        exact is transformed
        for exact, transformed in zip(reference, candidate, strict=True)
    )
    coverage_before = bool(coverage_is_valid(reference)) if reference else True
    coverage_after = (
        coverage_before
        if identical_objects
        else bool(coverage_is_valid(candidate)) if candidate else True
    )
    valid_after = bool(np.all(shapely.is_valid(candidate))) if candidate else True
    signatures_before = [geometry_signature(value) for value in reference]
    signatures_after = [geometry_signature(value) for value in candidate]
    adjacencies_before = _label_adjacencies(labels, reference)
    adjacencies_after = _label_adjacencies(labels, candidate)
    uncovered, multiply_covered, wrong_label = (
        (0, 0, 0)
        if identical_objects
        else voxel_center_errors(source_plane, candidate_by_label)
    )
    background_before = internal_background_components(source_plane, reference)
    background_after = (
        background_before
        if identical_objects
        else internal_background_components(source_plane, candidate)
    )

    region_metrics: list[RegionMetrics] = []
    error_samples: list[np.ndarray] = []
    for label, exact, transformed, before, after in zip(
        labels,
        reference,
        candidate,
        signatures_before,
        signatures_after,
        strict=True,
    ):
        reference_area = float(exact.area * resolution_um**2)
        candidate_area = float(transformed.area * resolution_um**2)
        area_change = candidate_area - reference_area
        if exact is transformed:
            iou = 1.0
        else:
            union_area = exact.union(transformed).area
            iou = 1.0 if union_area == 0 else float(exact.intersection(transformed).area / union_area)
        region_metrics.append(
            RegionMetrics(
                label=label,
                components_before=before[0],
                components_after=after[0],
                holes_before=before[1],
                holes_after=after[1],
                reference_area_um2=reference_area,
                candidate_area_um2=candidate_area,
                area_change_um2=area_change,
                relative_area_change=(area_change / reference_area if reference_area else 0.0),
                iou=iou,
            )
        )
        error_samples.append(
            np.zeros(1)
            if exact.equals(transformed)
            else boundary_errors(exact, transformed, resolution_um)
        )

    all_errors = np.concatenate(error_samples) if error_samples else np.zeros(1)
    eligible = [
        value
        for value in region_metrics
        if value.reference_area_um2 >= policy.minimum_iou_area_um2
    ]
    worst_iou = min(eligible, key=lambda value: (value.iou, value.label), default=None)
    worst_absolute = max(
        region_metrics,
        key=lambda value: (abs(value.area_change_um2), -value.label),
        default=None,
    )
    worst_relative = max(
        region_metrics,
        key=lambda value: (abs(value.relative_area_change), -value.label),
        default=None,
    )
    maximum_error = float(np.max(all_errors))
    geometries_unchanged = identical_objects or all(
        exact.equals(transformed)
        for exact, transformed in zip(reference, candidate, strict=True)
    )
    maximum_upper_bound = (
        0.0
        if geometries_unchanged
        else maximum_error + (resolution_um * 0.125 if labels else 0.0)
    )

    failures: list[str] = []
    if not coverage_before:
        failures.append("reference coverage is invalid")
    if not coverage_after:
        failures.append("candidate coverage is invalid")
    if not valid_after:
        failures.append("candidate contains invalid geometry")
    if signatures_before != signatures_after:
        failures.append("component or hole topology changed")
    if adjacencies_before != adjacencies_after:
        failures.append("region adjacency changed")
    if uncovered or multiply_covered or wrong_label:
        failures.append(
            "source voxel centres changed "
            f"(uncovered={uncovered}, multiply-covered={multiply_covered}, "
            f"wrong-label={wrong_label})"
        )
    if background_before != background_after:
        failures.append("internal background topology changed")
    if worst_iou is not None and worst_iou.iou < policy.minimum_iou:
        failures.append(
            f"region {worst_iou.label} IoU {worst_iou.iou:.6f} "
            f"is below {policy.minimum_iou:.6f}"
        )
    if maximum_upper_bound > policy.maximum_error_um:
        failures.append(
            f"boundary error upper bound {maximum_upper_bound:.3f} um "
            f"exceeds {policy.maximum_error_um:.3f} um"
        )

    finite_values = [
        value
        for item in region_metrics
        for value in (
            item.reference_area_um2,
            item.candidate_area_um2,
            item.area_change_um2,
            item.relative_area_change,
            item.iou,
        )
    ] + [
        float(np.median(all_errors)),
        float(np.percentile(all_errors, 95)),
        maximum_error,
        maximum_upper_bound,
    ]
    if not all(math.isfinite(value) for value in finite_values):
        failures.append("metric output is not finite")

    return ExperimentMetrics(
        region_count=len(labels),
        components_before=sum(value[0] for value in signatures_before),
        components_after=sum(value[0] for value in signatures_after),
        holes_before=sum(value[1] for value in signatures_before),
        holes_after=sum(value[1] for value in signatures_after),
        coverage_valid_before=coverage_before,
        coverage_valid_after=coverage_after,
        geometries_valid_after=valid_after,
        adjacency_count_before=len(adjacencies_before),
        adjacency_count_after=len(adjacencies_after),
        adjacency_preserved=adjacencies_before == adjacencies_after,
        uncovered_voxels=uncovered,
        multiply_covered_voxels=multiply_covered,
        wrong_label_voxels=wrong_label,
        internal_background_components_before=background_before,
        internal_background_components_after=background_after,
        background_topology_valid=background_before == background_after,
        minimum_eligible_region_iou=worst_iou.iou if worst_iou else 1.0,
        worst_iou_region=worst_iou.label if worst_iou else None,
        median_boundary_error_um=float(np.median(all_errors)),
        p95_boundary_error_um=float(np.percentile(all_errors, 95)),
        maximum_boundary_error_um=maximum_error,
        maximum_boundary_error_upper_bound_um=maximum_upper_bound,
        vertices_before=sum(len(get_coordinates(value.boundary)) for value in reference),
        vertices_after=sum(len(get_coordinates(value.boundary)) for value in candidate),
        worst_absolute_area_change_region=(worst_absolute.label if worst_absolute else None),
        worst_relative_area_change_region=(worst_relative.label if worst_relative else None),
        regions=tuple(region_metrics),
        failures=tuple(failures),
    )
