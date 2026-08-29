from __future__ import annotations

import json
import subprocess
from html.parser import HTMLParser
from pathlib import Path

import pytest

from tools.distribution_review_lab.build import (
    FORMAT,
    POLICY_VERSION,
    InputSpec,
    build_report,
    propose_display,
    render_report,
    sha256_file,
)


def _display(*, scales=("linear",), domain="full"):
    return {
        "scales": [{"kind": scale} for scale in scales],
        "preferred_scale": scales[-1],
        "distribution_domains": [{"kind": "full"}],
        "preferred_distribution_domain": domain,
    }


def _feature(
    identifier="feature",
    *,
    fraction=0.6,
    negative=2,
    zero=0,
    positive=2,
    lower=-2.0,
    upper=2.0,
):
    finite = negative + zero + positive
    thresholds = [
        {"linear_threshold": value, "histogram": {"edges": [-2, 0, 2], "counts": [2, 2]}}
        for value in (0.1, 0.5, 1.0)
    ]
    histogram = {"edges": [lower, (lower + upper) / 2, upper], "counts": [2, 2]}
    return {
        "id": identifier,
        "value_counts": {
            "total_count": finite,
            "finite_count": finite,
            "missing_count": 0,
            "negative_count": negative,
            "zero_count": zero,
            "positive_count": positive,
        },
        "summary": {"min": lower, "q01": lower, "q50": 0, "q99": upper, "max": upper},
        "diagnostics": {"full_linear_largest_bin_fraction": fraction},
        "candidates": {
            "full": {
                "linear": {"availability": "available", "histogram": histogram},
                "log": {"availability": "available" if positive == finite else "unavailable", "histogram": histogram},
                "symlog": {"availability": "candidate-only", "threshold_candidates": thresholds},
            },
            "focused": {
                "availability": "candidate-only",
                "bounds": {"lower": lower, "upper": upper},
                "whole_population_count": finite,
                "underflow_count": 0,
                "overflow_count": 0,
                "inside_count": finite,
                "variants": {
                    "linear": {"availability": "available", "histogram": histogram},
                    "log": {"availability": "available" if positive == finite else "unavailable", "histogram": histogram},
                    "symlog": {"availability": "candidate-only", "threshold_candidates": thresholds},
                },
            },
        },
    }


def test_channel_policy_uses_exact_thresholds_and_exclusions():
    proposal, _ = propose_display("ephys_atlas_channels", _feature(), _display())
    assert proposal == {
        "scales": [
            {"kind": "linear"},
            {"kind": "symlog", "linear_threshold": 0.5},
        ],
        "preferred_scale": "linear",
        "distribution_domains": [
            {"kind": "full"}, {"kind": "focused", "bounds": [-2.0, 2.0]}
        ],
        "preferred_distribution_domain": "focused",
    }
    positive = _feature(negative=0, positive=4, lower=0.1, upper=4)
    proposal, _ = propose_display("ephys_atlas_channels", positive, _display())
    assert [item["kind"] for item in proposal["scales"]] == ["linear", "log"]
    excluded = _feature("spike_count.raw", fraction=1)
    proposal, _ = propose_display("ephys_atlas_channels", excluded, _display())
    assert proposal == _display()


def test_d052_baseline_is_retained_exactly():
    accepted = {
        "scales": [{"kind": "linear"}, {"kind": "symlog", "linear_threshold": 1.23}],
        "preferred_scale": "linear",
        "distribution_domains": [
            {"kind": "full"}, {"kind": "focused", "bounds": [-9.467077467918395, 2.5583932574651715]}
        ],
        "preferred_distribution_domain": "focused",
    }
    proposal, rationale = propose_display(
        "ephys_atlas_channels", _feature("peak_val.raw", fraction=0.999), accepted
    )
    assert proposal == accepted
    assert any("D052" in reason for reason in rationale)


def test_cluster_policy_preserves_logs_and_special_cases_noise_cutoff():
    baseline = _display(scales=("linear", "log"))
    proposal, _ = propose_display(
        "ephys_atlas_clusters", _feature("amp_max", fraction=0.99, negative=0, positive=4), baseline
    )
    assert [item["kind"] for item in proposal["scales"]] == ["linear", "log"]
    assert proposal["preferred_scale"] == "log"
    assert proposal["preferred_distribution_domain"] == "focused"
    noise, _ = propose_display(
        "ephys_atlas_clusters", _feature("noise_cutoff", fraction=0.99), _display()
    )
    assert noise["scales"][-1] == {"kind": "symlog", "linear_threshold": 0.1}
    assert noise["preferred_scale"] == "symlog"
    assert noise["preferred_distribution_domain"] == "focused"
    bounded, _ = propose_display(
        "ephys_atlas_clusters", _feature("presence_ratio", fraction=0.99), baseline
    )
    assert bounded["distribution_domains"] == [{"kind": "full"}]


def test_bwm_and_volume_policy_stay_linear_full():
    for dataset in ("brainwide_map", "ephys_atlas_volumes"):
        accepted = _display()
        proposal, _ = propose_display(dataset, _feature(fraction=1), accepted)
        assert proposal == accepted


def _write_inputs(tmp_path: Path, *, mismatch=False) -> InputSpec:
    feature = _feature()
    audit = {
        "schema_version": "1.0",
        "audit_id": "ephys-atlas-distribution-audit-v1",
        "dataset_id": "ephys_atlas_channels",
        "release_id": "r1",
        "representation": "regional",
        "population": "synthetic rows",
        "observation_unit": "rows",
        "read_only": True,
        "defaults_selected": False,
        "features": [feature],
    }
    selection = {
        "schema": "ibl-scalar-distribution-selection-v1",
        "selection_id": "accepted-v1",
        "dataset_id": "ephys_atlas_channels",
        "representation": "regional",
        "source_release_id": "wrong" if mismatch else "r1",
        "scientific_owner_confirmation": True,
        "features": [{"id": "feature", "display": _display()}],
    }
    audit_path, selection_path = tmp_path / "audit.json", tmp_path / "selection.json"
    audit_path.write_text(json.dumps(audit))
    selection_path.write_text(json.dumps(selection))
    return InputSpec(audit_path, selection_path, sha256_file(audit_path))


def test_report_binds_exact_evidence_and_never_contains_an_approval_field(tmp_path: Path):
    report = build_report([_write_inputs(tmp_path)])
    assert report["format"] == FORMAT
    assert report["policy_version"] == POLICY_VERSION
    dataset = report["datasets"][0]
    assert dataset["audit_sha256"] == sha256_file(tmp_path / "audit.json")
    assert len(dataset["features"]) == 1
    assert "scientific_owner_confirmation" not in json.dumps(report)


def test_report_fails_closed_on_hash_release_and_catalog_mismatch(tmp_path: Path):
    spec = _write_inputs(tmp_path)
    with pytest.raises(ValueError, match="SHA-256"):
        build_report([InputSpec(spec.audit, spec.selection, "0" * 64)])
    spec = _write_inputs(tmp_path, mismatch=True)
    with pytest.raises(ValueError, match="source release"):
        build_report([spec])


class _Parser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids = set()

    def handle_starttag(self, _tag, attrs):
        identifier = dict(attrs).get("id")
        if identifier:
            self.ids.add(identifier)


def test_offline_template_has_stable_controls_valid_javascript_and_safe_payload():
    template = Path("tools/distribution_review_lab/template.html").read_text()
    parser = _Parser()
    parser.feed(template)
    assert {"tabs", "search", "features", "detail", "download", "report-data"} <= parser.ids
    script = template.rsplit("<script>", 1)[1].split("</script>", 1)[0]
    subprocess.run(["node", "--check"], input=script, text=True, check=True)
    rendered = render_report({"unsafe": "</script>"}, template)
    assert b"<\\/script>" in rendered
    assert b"https://" not in rendered
    with pytest.raises(ValueError, match="external resource"):
        render_report({}, template + '<script src="https://example.test/x.js"></script>')
