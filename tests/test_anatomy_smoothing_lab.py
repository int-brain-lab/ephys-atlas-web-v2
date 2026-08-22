from __future__ import annotations

import json
import os
import subprocess
from html.parser import HTMLParser
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest

from tools.anatomy_smoothing_lab import (
    Eligibility,
    EvaluationPolicy,
    available_strategies,
    parse_tolerances_um,
    run_experiment,
)
from tools.anatomy_smoothing_lab.synthetic import synthetic_planes
from tools.anatomy_smoothing_lab.build import (
    DEFAULT_PARENT,
    DEFAULT_SAMPLED,
    _load_parent_slice,
    build_synthetic_report,
    parse_args,
    render_report,
    select_stress_samples,
    sha256_file,
    write_report,
)
from tools.anatomy_pack.build_v2 import _write_pack, slice_paths


POLICY = EvaluationPolicy(
    maximum_error_um=20,
    minimum_iou=0.98,
    minimum_iou_area_um2=100,
)


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


def test_exact_strategy_accepts_an_empty_edge_plane() -> None:
    result = run_experiment(
        np.zeros((6, 7), dtype=np.int16),
        strategy_id="exact",
        parameters={},
        resolution_um=10,
        policy=POLICY,
    )
    assert result.eligibility == Eligibility.REFERENCE
    assert result.metrics is not None
    assert result.metrics.region_count == 0


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


def test_stress_selection_records_categories_and_uses_lower_ties() -> None:
    planes = synthetic_planes()
    ordered = list(planes.values())
    selected = select_stress_samples(range(len(ordered)), ordered.__getitem__, int)

    assert selected == select_stress_samples(range(len(ordered)), ordered.__getitem__, int)
    assert list(selected) == sorted(selected)
    assert any("central active-display plane" in reasons for reasons in selected.values())
    assert any("bilateral signed-ID coverage" in reasons for reasons in selected.values())


def _synthetic_args(output: Path):
    return parse_args(
        [
            "--synthetic",
            "--offline",
            "--created-at",
            "2026-08-22T00:00:00Z",
            "--strategies",
            "exact,geos-coverage-simplify,independent-ring-rdp-unsafe",
            "--tolerances-um",
            "0,5",
            "--maximum-error-um",
            "20",
            "--minimum-iou",
            "0.98",
            "--output",
            str(output),
        ]
    )


def test_two_fixed_synthetic_reports_are_byte_identical(tmp_path: Path) -> None:
    repository = Path(__file__).resolve().parents[1]
    template = Path("tools/anatomy_smoothing_lab/template.html")
    first = tmp_path / "first.html"
    second = tmp_path / "second.html"
    first_report = build_synthetic_report(_synthetic_args(first), repository)
    second_report = build_synthetic_report(_synthetic_args(second), repository)
    write_report(first_report, template, first)
    write_report(second_report, template, second)

    assert first.read_bytes() == second.read_bytes()
    assert first_report["format"] == "ibl-anatomy-smoothing-lab-v1"
    assert first_report["source"]["non_scientific"] is True
    assert {item["projection"] for item in first_report["planes"]} == {
        "coronal",
        "sagittal",
        "horizontal",
    }
    assert b"https://" not in first.read_bytes()
    assert first_report["reproduction_command"].endswith("--output <output.html>")
    assert str(tmp_path) not in first_report["reproduction_command"]
    assert all(
        str(region["label"]) in first_report["region_metadata"]
        for plane in first_report["planes"]
        for variant in plane["variants"]
        for region in (variant["metrics"] or {}).get("regions", [])
    )


class _SemanticReportParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.ids: set[str] = set()
        self.review_panels: set[str] = set()
        self.controls: set[str] = set()

    def handle_starttag(self, _tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        if values.get("id"):
            self.ids.add(values["id"])
        if values.get("data-review-panel"):
            self.review_panels.add(values["data-review-panel"])
        if values.get("data-control"):
            self.controls.add(values["data-control"])


def test_offline_ui_has_stable_semantic_controls_and_valid_javascript() -> None:
    template = Path("tools/anatomy_smoothing_lab/template.html").read_text()
    parser = _SemanticReportParser()
    parser.feed(template)
    assert parser.review_panels == {"exact", "candidate"}
    assert {
        "projection",
        "sample",
        "strategy",
        "variant",
        "mode",
        "opacity",
        "brightness",
        "contrast",
        "zoom",
        "stroke-width",
        "line-join",
        "line-cap",
    } <= parser.controls
    assert {"status", "failures", "regions", "provenance", "reproduction"} <= parser.ids
    script = template.rsplit("<script>", 1)[1].split("</script>", 1)[0]
    subprocess.run(["node", "--check"], input=script, text=True, check=True)


def test_report_inline_json_is_escaped_and_external_templates_are_rejected() -> None:
    template = '<script type="application/json">__ANATOMY_SMOOTHING_LAB_DATA__</script>'
    rendered = render_report({"unsafe": "</script>"}, template)
    assert b"<\\/script>" in rendered
    with pytest.raises(ValueError, match="external resource"):
        render_report({}, template + '<script src="https://example.test/x.js"></script>')


def test_checked_in_sparse_inventory_is_bound_to_exact_parent() -> None:
    parent_manifest = DEFAULT_PARENT / "manifest.json"
    parent = json.loads(parent_manifest.read_text())
    sampled = json.loads((DEFAULT_SAMPLED / "manifest.json").read_text())

    assert sampled["parent"]["pack_id"] == parent["pack_id"]
    assert sampled["parent"]["manifest_sha256"] == sha256_file(parent_manifest)
    for projection in ("coronal", "sagittal", "horizontal"):
        indices = sampled["projections"][projection]["display_slice_indices"]
        assert indices == sorted(set(indices))
        assert all(0 <= index < parent["projections"][projection]["slice_count"] for index in indices)
        assert _load_parent_slice(DEFAULT_PARENT, parent, projection, indices[len(indices) // 2])


def test_regenerated_paths_match_a_verified_temporary_parent_pack(tmp_path: Path) -> None:
    regions = SimpleNamespace(
        id=np.asarray([0, -1, 1, 2], dtype=np.int64),
        mappings={name: np.arange(4) for name in ("Allen", "Beryl", "Cosmos")},
    )
    plane = synthetic_planes()["t_junction"]
    paths, _validation = slice_paths(plane, regions)
    artifact = _write_pack(
        tmp_path,
        pack_id="synthetic-reference",
        projection="coronal",
        depth=8,
        pack_index=0,
        slices=[{"slice_index": 0, "world_coordinate_um": 0, "paths": paths}],
    )
    parent = {
        "projections": {
            "coronal": {
                "pack_sets": {
                    "8": {"packs": [artifact]},
                }
            }
        }
    }
    assert _load_parent_slice(tmp_path, parent, "coronal", 0)["paths"] == paths


@pytest.mark.skipif(
    not os.environ.get("EPHYS_ATLAS_ANATOMY_10UM_LUT"),
    reason="optional canonical regeneration requires the external 2.4 GB LUT",
)
def test_optional_real_plane_regenerates_checked_in_exact_bytes() -> None:
    from iblatlas.regions import BrainRegions
    from tools.anatomy_pack.build_v2 import plane_for_projection

    lut = np.load(os.environ["EPHYS_ATLAS_ANATOMY_10UM_LUT"], mmap_mode="r")
    parent = json.loads((DEFAULT_PARENT / "manifest.json").read_text())
    regions = BrainRegions()
    for projection in ("coronal", "sagittal", "horizontal"):
        sampled = json.loads((DEFAULT_SAMPLED / "manifest.json").read_text())
        index = sampled["projections"][projection]["display_slice_indices"][0]
        paths, _validation = slice_paths(plane_for_projection(lut, projection, index), regions)
        assert _load_parent_slice(DEFAULT_PARENT, parent, projection, index)["paths"] == paths
