from __future__ import annotations

import json

import numpy as np
import pytest

from tools.anatomy_smoothing_lab import (
    Eligibility,
    EvaluationPolicy,
    available_strategies,
    parse_tolerances_um,
    run_experiment,
)


POLICY = EvaluationPolicy(
    maximum_error_um=20,
    minimum_iou=0.98,
    minimum_iou_area_um2=100,
)


def synthetic_planes() -> dict[str, np.ndarray]:
    shared_edges = np.asarray(
        [[-1, -1, 1, 1], [-1, -1, 1, 1], [-2, -2, 2, 2], [-2, -2, 2, 2]],
        dtype=np.int16,
    )
    t_junction = np.asarray(
        [[1, 1, 2, 2], [1, 1, 2, 2], [3, 3, 2, 2], [3, 3, 2, 2]],
        dtype=np.int16,
    )
    checkerboard = np.asarray(
        [[1, 2, 1, 2], [2, 1, 2, 1], [1, 2, 1, 2], [2, 1, 2, 1]],
        dtype=np.int16,
    )
    hole = np.ones((7, 7), dtype=np.int16)
    hole[2:5, 2:5] = 0
    islands = np.zeros((7, 7), dtype=np.int16)
    islands[1:3, 1:3] = 1
    islands[4:6, 4:6] = 1
    cavity = np.ones((9, 9), dtype=np.int16)
    cavity[2:7, 2:7] = 0
    cavity[4, 4] = 2
    edge_contact = np.zeros((6, 7), dtype=np.int16)
    edge_contact[:3, :4] = 1
    edge_contact[3:, 3:] = 2
    return {
        "bilateral_shared_edges": shared_edges,
        "t_junction": t_junction,
        "checkerboard": checkerboard,
        "hole": hole,
        "disconnected_islands": islands,
        "background_cavity": cavity,
        "plane_edge_contact": edge_contact,
    }


def test_tolerance_parsing_is_canonical_and_rejects_invalid_values() -> None:
    assert parse_tolerances_um("10, 0,2.5,10,-0") == (0.0, 2.5, 10.0)
    for invalid in ("", "nan", "inf", "-1", "one"):
        with pytest.raises(ValueError):
            parse_tolerances_um(invalid)


def test_strategy_registry_has_stable_unique_identity() -> None:
    definitions = available_strategies()
    assert [item.strategy_id for item in definitions] == [
        "exact",
        "geos-coverage-simplify",
        "independent-ring-rdp-unsafe",
    ]
    assert all(item.version == "1" for item in definitions)
    assert definitions[-1].unsafe_control


@pytest.mark.parametrize("name", synthetic_planes())
def test_exact_strategy_preserves_every_synthetic_structure(name: str) -> None:
    result = run_experiment(
        synthetic_planes()[name],
        strategy_id="exact",
        parameters={},
        resolution_um=10,
        policy=POLICY,
    )
    assert result.eligibility == Eligibility.REFERENCE
    assert result.generation_failure is None
    assert result.metrics is not None
    assert result.metrics.failures == ()
    assert result.metrics.components_before == result.metrics.components_after
    assert result.metrics.holes_before == result.metrics.holes_after
    assert result.metrics.adjacency_preserved
    assert result.metrics.uncovered_voxels == 0
    assert result.metrics.multiply_covered_voxels == 0
    assert result.metrics.wrong_label_voxels == 0
    assert result.metrics.maximum_boundary_error_upper_bound_um == 0


def test_coverage_strategy_is_deterministic_and_retains_complete_metrics() -> None:
    plane = synthetic_planes()["t_junction"]
    kwargs = dict(
        strategy_id="geos-coverage-simplify",
        parameters={"tolerance_um": 2.5, "simplify_boundary": False},
        resolution_um=10,
        policy=POLICY,
    )
    first = run_experiment(plane, **kwargs)
    second = run_experiment(plane, **kwargs)

    assert first.deterministic_record() == second.deterministic_record()
    assert json.dumps(first.deterministic_record(), sort_keys=True, allow_nan=False)
    assert first.metrics is not None
    assert first.metrics.regions
    assert first.metrics.worst_absolute_area_change_region is not None
    assert first.metrics.worst_relative_area_change_region is not None


def test_rejected_candidate_keeps_metrics_and_failure_reasons() -> None:
    plane = np.zeros((20, 20), dtype=np.int16)
    for row in range(2, 18):
        plane[row, 2:row] = 1
        plane[row, row:18] = 2
    strict_policy = EvaluationPolicy(
        maximum_error_um=0,
        minimum_iou=1,
        minimum_iou_area_um2=0,
    )
    result = run_experiment(
        plane,
        strategy_id="geos-coverage-simplify",
        parameters={"tolerance_um": 10, "simplify_boundary": True},
        resolution_um=10,
        policy=strict_policy,
    )
    assert result.eligibility == Eligibility.REJECTED
    assert result.generation_failure is None
    assert result.metrics is not None
    assert result.metrics.failures
    assert result.geometries_by_label is not None


def test_unsafe_ring_control_can_never_be_eligible() -> None:
    result = run_experiment(
        synthetic_planes()["bilateral_shared_edges"],
        strategy_id="independent-ring-rdp-unsafe",
        parameters={"tolerance_um": 5},
        resolution_um=10,
        policy=POLICY,
    )
    assert result.eligibility == Eligibility.UNSAFE_CONTROL


def test_parameter_and_generation_failures_are_explicit() -> None:
    with pytest.raises(ValueError, match="requires parameters"):
        run_experiment(
            synthetic_planes()["hole"],
            strategy_id="geos-coverage-simplify",
            parameters={"tolerance_um": 5},
            resolution_um=10,
            policy=POLICY,
        )
    with pytest.raises(ValueError, match="unknown strategy"):
        run_experiment(
            synthetic_planes()["hole"],
            strategy_id="unknown",
            parameters={},
            resolution_um=10,
            policy=POLICY,
        )
