from __future__ import annotations

import numpy as np
import pytest

from ephys_atlas_builder.regional_release import (
    build_global_distribution_binnings,
    histogram_counts_and_tails,
    histogram_edges,
    validate_scalar_display,
)


def _display() -> dict:
    return {
        "scales": [
            {"kind": "linear"},
            {"kind": "symlog", "linear_threshold": 2.0},
        ],
        "preferred_scale": "symlog",
        "distribution_domains": [
            {"kind": "full"},
            {"kind": "focused", "bounds": [-3.0, 5.0]},
        ],
        "preferred_distribution_domain": "focused",
    }


def test_distribution_binnings_form_exact_rectangular_cross_product() -> None:
    values = np.array([-100.0, -3.0, -1.0, 0.0, 2.0, 5.0, 100.0, np.nan])
    binnings = build_global_distribution_binnings(values, 4, _display())
    assert [item["id"] for item in binnings] == [
        "linear-full",
        "linear-focused",
        "symlog-full",
        "symlog-focused",
    ]
    for binning in binnings:
        assert (
            binning["global_underflow_count"]
            + sum(binning["global_counts"])
            + binning["global_overflow_count"]
        ) == 7
    for binning in (binnings[1], binnings[3]):
        assert binning["edges"][0] == -3.0
        assert binning["edges"][-1] == 5.0
        assert binning["global_underflow_count"] == 1
        assert binning["global_overflow_count"] == 1
    for domain in ("full", "focused"):
        endpoints = {
            (item["edges"][0], item["edges"][-1])
            for item in binnings
            if item["domain"]["kind"] == domain
        }
        assert len(endpoints) == 1


def test_symlog_edges_are_uniform_in_the_declared_transform() -> None:
    edges = histogram_edges(
        np.array([-10.0, 10.0]), 4, "symlog", linear_threshold=2.0
    )
    transformed = np.sign(edges) * np.log1p(np.abs(edges) / 2.0)
    np.testing.assert_allclose(np.diff(transformed), np.diff(transformed)[0])


def test_symlog_edges_have_platform_independent_float64_values() -> None:
    edges = histogram_edges(
        np.array([-0.5, 3.5]), 8, "symlog", linear_threshold=0.5
    )
    assert edges.tolist() == [
        -0.5,
        -0.20710678118654752,
        0.0,
        0.2071067811865475,
        0.5,
        0.9142135623730953,
        1.4999999999999996,
        2.3284271247461894,
        3.5,
    ]


def test_symlog_edges_remain_finite_and_increasing_at_float64_extremes() -> None:
    maximum = np.finfo(np.float64).max
    edges = histogram_edges(
        np.array([-maximum, maximum]),
        8,
        "symlog",
        linear_threshold=1.0,
    )
    assert np.isfinite(edges).all()
    assert np.all(np.diff(edges) > 0)
    assert edges[0] == -maximum
    assert edges[-1] == maximum


def test_symlog_edges_preserve_representable_values_far_below_threshold() -> None:
    edges = histogram_edges(
        np.array([-1e-100, 1e-100]),
        4,
        "symlog",
        linear_threshold=1.0,
    )
    assert np.all(np.diff(edges) > 0)
    assert edges[2] == 0.0


@pytest.mark.parametrize("threshold", [float("nan"), float("inf"), 0.0])
def test_symlog_edges_reject_nonfinite_or_nonpositive_thresholds(
    threshold: float,
) -> None:
    with pytest.raises(ValueError, match="finite positive"):
        histogram_edges(
            np.array([-1.0, 1.0]),
            4,
            "symlog",
            linear_threshold=threshold,
        )


def test_log_edges_support_a_tiny_positive_constant_population() -> None:
    edges = histogram_edges(np.array([1e-15, 1e-15]), 4, "log")
    assert np.all(edges > 0)
    assert np.all(np.diff(edges) > 0)


def test_constant_population_uses_one_raw_domain_across_scales() -> None:
    display = {
        "scales": [{"kind": "linear"}, {"kind": "log"}],
        "preferred_scale": "log",
        "distribution_domains": [{"kind": "full"}],
        "preferred_distribution_domain": "full",
    }
    binnings = build_global_distribution_binnings(
        np.array([1e-15, 1e-15]), 4, display
    )
    assert (binnings[0]["edges"][0], binnings[0]["edges"][-1]) == (
        binnings[1]["edges"][0],
        binnings[1]["edges"][-1],
    )


def test_histogram_tails_keep_endpoints_visible() -> None:
    counts, underflow, overflow = histogram_counts_and_tails(
        np.array([-2.0, -1.0, 0.0, 1.0, 2.0]), np.array([-1.0, 0.0, 1.0])
    )
    assert counts.tolist() == [1, 2]
    assert (underflow, overflow) == (1, 1)


def test_display_rejects_log_for_a_nonpositive_complete_population() -> None:
    display = {
        **_display(),
        "scales": [{"kind": "linear"}, {"kind": "log"}],
        "preferred_scale": "log",
    }
    with pytest.raises(ValueError, match="every finite observation"):
        validate_scalar_display(display, np.array([0.0, 1.0]))


def test_builder_rejects_focused_bounds_outside_the_full_population() -> None:
    display = {
        **_display(),
        "distribution_domains": [
            {"kind": "full"},
            {"kind": "focused", "bounds": [-20.0, 20.0]},
        ],
    }
    with pytest.raises(ValueError, match="inside the full finite domain"):
        build_global_distribution_binnings(np.array([-10.0, 10.0]), 4, display)
