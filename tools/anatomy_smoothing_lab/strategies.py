"""Strategy registry and failure-preserving experiment execution."""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass
from enum import StrEnum
from typing import Any, Callable, Iterable, Mapping, TypeAlias

import numpy as np
from shapely import coverage_simplify, get_parts
from shapely.geometry import MultiPolygon, Polygon

from tools.anatomy_compare.build import simplify_ring
from tools.anatomy_pack.geometry import raster_label_geometries
from tools.anatomy_smoothing_lab.metrics import (
    EvaluationPolicy,
    ExperimentMetrics,
    Geometry,
    measure_candidate,
)


class Eligibility(StrEnum):
    REFERENCE = "reference"
    ELIGIBLE = "eligible"
    REJECTED = "rejected"
    UNSAFE_CONTROL = "unsafe-control"


@dataclass(frozen=True)
class GenerationFailure:
    exception_type: str
    message: str


@dataclass(frozen=True)
class ExactParameters:
    pass


@dataclass(frozen=True)
class CoverageSimplifyParameters:
    tolerance_um: float
    simplify_boundary: bool


@dataclass(frozen=True)
class IndependentRingRdpParameters:
    tolerance_um: float


StrategyParameters: TypeAlias = (
    ExactParameters | CoverageSimplifyParameters | IndependentRingRdpParameters
)


@dataclass(frozen=True)
class StrategyDefinition:
    strategy_id: str
    label: str
    algorithm: str
    version: str
    shared_edge_topology_expected: bool
    unsafe_control: bool
    generate: Callable[[dict[int, Geometry], StrategyParameters, int], dict[int, Geometry]]


@dataclass(frozen=True)
class ExperimentResult:
    strategy_id: str
    strategy_version: str
    parameters: StrategyParameters
    eligibility: Eligibility
    generation_failure: GenerationFailure | None
    metrics: ExperimentMetrics | None
    geometries_by_label: dict[int, Geometry] | None

    def deterministic_record(self) -> dict[str, Any]:
        return {
            "strategy_id": self.strategy_id,
            "strategy_version": self.strategy_version,
            "parameters": asdict(self.parameters),
            "eligibility": self.eligibility.value,
            "generation_failure": (
                asdict(self.generation_failure) if self.generation_failure else None
            ),
            "metrics": self.metrics.to_dict() if self.metrics else None,
        }


def parse_tolerances_um(value: str | Iterable[float]) -> tuple[float, ...]:
    """Parse, validate, sort, and deterministically deduplicate tolerances."""
    raw: Iterable[float | str]
    if isinstance(value, str):
        raw = (part.strip() for part in value.split(","))
    else:
        raw = value
    parsed: set[float] = set()
    for item in raw:
        if isinstance(item, bool) or item == "":
            raise ValueError("tolerances must be numeric")
        try:
            tolerance = float(item)
        except (TypeError, ValueError) as exc:
            raise ValueError("tolerances must be numeric") from exc
        if not math.isfinite(tolerance) or tolerance < 0:
            raise ValueError("tolerances must be finite and non-negative")
        parsed.add(0.0 if tolerance == 0 else tolerance)
    if not parsed:
        raise ValueError("at least one tolerance is required")
    return tuple(sorted(parsed))


def _exact(
    exact: dict[int, Geometry], _parameters: StrategyParameters, _resolution_um: int
) -> dict[int, Geometry]:
    return dict(exact)


def _coverage(
    exact: dict[int, Geometry], parameters: StrategyParameters, resolution_um: int
) -> dict[int, Geometry]:
    if not isinstance(parameters, CoverageSimplifyParameters):
        raise TypeError("coverage strategy received incompatible parameters")
    labels = sorted(exact)
    values = [exact[label] for label in labels]
    if parameters.tolerance_um == 0:
        return dict(exact)
    simplified = coverage_simplify(
        values,
        tolerance=parameters.tolerance_um / resolution_um,
        simplify_boundary=parameters.simplify_boundary,
    )
    return dict(zip(labels, simplified, strict=True))


def _simplify_polygon(polygon: Polygon, tolerance: float) -> Polygon:
    exterior = simplify_ring(np.asarray(polygon.exterior.coords), tolerance)
    interiors = [
        simplify_ring(np.asarray(interior.coords), tolerance)
        for interior in polygon.interiors
    ]
    return Polygon(exterior, interiors)


def _independent_rdp(
    exact: dict[int, Geometry], parameters: StrategyParameters, resolution_um: int
) -> dict[int, Geometry]:
    if not isinstance(parameters, IndependentRingRdpParameters):
        raise TypeError("independent RDP strategy received incompatible parameters")
    tolerance = parameters.tolerance_um / resolution_um
    result: dict[int, Geometry] = {}
    for label, geometry in sorted(exact.items()):
        polygons = [_simplify_polygon(part, tolerance) for part in get_parts(geometry)]
        result[label] = polygons[0] if len(polygons) == 1 else MultiPolygon(polygons)
    return result


_STRATEGIES = {
    definition.strategy_id: definition
    for definition in (
        StrategyDefinition(
            "exact",
            "Exact cell-edge reference",
            "collinear-only exact geometry",
            "1",
            True,
            False,
            _exact,
        ),
        StrategyDefinition(
            "geos-coverage-simplify",
            "GEOS coverage simplification",
            "GEOS coverage_simplify",
            "1",
            True,
            False,
            _coverage,
        ),
        StrategyDefinition(
            "independent-ring-rdp-unsafe",
            "Independent ring RDP (unsafe control)",
            "independent deterministic Ramer-Douglas-Peucker",
            "1",
            False,
            True,
            _independent_rdp,
        ),
    )
}


def available_strategies() -> tuple[StrategyDefinition, ...]:
    return tuple(_STRATEGIES[key] for key in sorted(_STRATEGIES))


def _canonical_parameters(
    definition: StrategyDefinition, parameters: Mapping[str, Any]
) -> StrategyParameters:
    if definition.strategy_id == "exact":
        if parameters:
            raise ValueError("exact strategy takes no parameters")
        return ExactParameters()
    allowed = {"tolerance_um"}
    if definition.strategy_id == "geos-coverage-simplify":
        allowed.add("simplify_boundary")
    if set(parameters) != allowed:
        raise ValueError(
            f"{definition.strategy_id} requires parameters {sorted(allowed)}"
        )
    tolerance = parse_tolerances_um([parameters["tolerance_um"]])[0]
    if definition.strategy_id == "geos-coverage-simplify":
        if not isinstance(parameters["simplify_boundary"], bool):
            raise ValueError("simplify_boundary must be boolean")
        return CoverageSimplifyParameters(
            tolerance_um=tolerance,
            simplify_boundary=parameters["simplify_boundary"],
        )
    return IndependentRingRdpParameters(tolerance_um=tolerance)


def run_experiment(
    source_plane: np.ndarray,
    *,
    strategy_id: str,
    parameters: Mapping[str, Any],
    resolution_um: int,
    policy: EvaluationPolicy,
) -> ExperimentResult:
    """Generate and measure one variant while preserving rejected evidence."""
    try:
        definition = _STRATEGIES[strategy_id]
    except KeyError as exc:
        raise ValueError(f"unknown strategy {strategy_id!r}") from exc
    canonical = _canonical_parameters(definition, parameters)
    exact = raster_label_geometries(source_plane)
    try:
        candidate = definition.generate(exact, canonical, resolution_um)
        metrics = measure_candidate(
            exact,
            candidate,
            source_plane=source_plane,
            resolution_um=resolution_um,
            policy=policy,
        )
    except Exception as exc:  # retained as experiment evidence by design
        return ExperimentResult(
            definition.strategy_id,
            definition.version,
            canonical,
            Eligibility.UNSAFE_CONTROL if definition.unsafe_control else Eligibility.REJECTED,
            GenerationFailure(type(exc).__name__, str(exc)),
            None,
            None,
        )

    if definition.strategy_id == "exact":
        eligibility = Eligibility.REFERENCE if not metrics.failures else Eligibility.REJECTED
    elif definition.unsafe_control:
        eligibility = Eligibility.UNSAFE_CONTROL
    else:
        eligibility = Eligibility.ELIGIBLE if not metrics.failures else Eligibility.REJECTED
    return ExperimentResult(
        definition.strategy_id,
        definition.version,
        canonical,
        eligibility,
        None,
        metrics,
        candidate,
    )
