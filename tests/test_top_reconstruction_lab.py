from __future__ import annotations

from html.parser import HTMLParser
import json
from types import SimpleNamespace

import numpy as np

from tools.top_reconstruction_lab.build import (
    FORMAT,
    REVIEW_FORMAT,
    build_report,
    dorsal_surface_rows,
    dorsal_surface_rows_from_lut,
    render_report,
    validated_lut_parent,
)


class _Parser(HTMLParser):
    pass


def _regions() -> SimpleNamespace:
    # Three right rows followed by their physical-left counterparts.
    return SimpleNamespace(
        id=np.asarray([0, 10, 20, 30, -10, -20, -30]),
        mappings={name: np.arange(7) for name in ("Allen", "Beryl", "Cosmos")},
        acronym=np.asarray(["root", "A", "B", "C", "A", "B", "C"]),
        name=np.asarray(["root", "Alpha", "Beta", "Gamma", "Alpha", "Beta", "Gamma"]),
        rgb=np.asarray(
            [
                [0, 0, 0],
                [10, 20, 30],
                [40, 50, 60],
                [70, 80, 90],
                [10, 20, 30],
                [40, 50, 60],
                [70, 80, 90],
            ]
        ),
    )


def test_dorsal_surface_uses_first_nonzero_and_lateralizes_left() -> None:
    raw = np.zeros((2, 230, 4), dtype=np.int32)
    raw[0, 0, 2] = 10
    raw[0, 0, 3] = 20
    raw[1, 229, 1] = 20

    surface = dorsal_surface_rows(raw, _regions())

    assert surface[0, 0] == 4  # row 1 shifted to its negative/left counterpart
    assert surface[1, 229] == 2  # first right column remains positive
    assert np.count_nonzero(surface) == 2


def test_bilateral_lut_surface_is_extracted_in_bounded_ap_blocks() -> None:
    lut = np.zeros((5, 4, 6), dtype=np.uint16)
    lut[0, 0, 4] = 4
    lut[0, 0, 5] = 1
    lut[4, 3, 2] = 2
    progress: list[tuple[int, int]] = []

    surface = dorsal_surface_rows_from_lut(
        lut,
        _regions(),
        block_size=2,
        progress=lambda done, total: progress.append((done, total)),
    )

    assert surface[0, 0] == 4
    assert surface[4, 3] == 2
    assert np.count_nonzero(surface) == 2
    assert progress == [(2, 5), (4, 5), (5, 5)]


def test_lut_is_bound_to_hash_pinned_validated_parent(tmp_path) -> None:
    lut = tmp_path / "labels.npy"
    lut.write_bytes(b"lut")
    import hashlib

    lut_sha = hashlib.sha256(b"lut").hexdigest()
    manifest = {
        "format": "anatomy-pack-v2",
        "immutable": True,
        "pack_id": "canonical-parent",
        "source": {
            "resolution_um": 10,
            "region_lut": {"path": "labels.npy", "bytes": 3, "sha256": lut_sha},
            "annotation": {
                "path": "annotation_10.nrrd",
                "bytes": 4,
                "sha256": "a" * 64,
            },
        },
        "provenance": {"generator": {"commit": "b" * 40, "dirty": False}},
        "validation": {
            "topology_valid": True,
            "coverage_valid": True,
            "background_topology_valid": True,
            "adjacency_mismatches": 0,
            "invalid_geometries": 0,
            "multiply_covered_voxels": 0,
            "uncovered_voxels": 0,
        },
    }
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text(json.dumps(manifest))

    evidence = validated_lut_parent(
        manifest_path, lut, lut_sha256=lut_sha, resolution_um=10
    )

    assert evidence["pack_id"] == "canonical-parent"
    assert evidence["annotation"]["sha256"] == "a" * 64


def test_report_retains_variants_metrics_inventory_and_no_production_effect() -> None:
    plane = np.zeros((8, 8), dtype=np.int32)
    plane[1:7, 1:4] = 4
    plane[1:7, 4:7] = 1
    legacy = (
        '<path class="atlas-region" fill-rule="evenodd" data-allen-id="-10" '
        'data-beryl-id="-10" data-cosmos-id="-10" d="M0 0L1 0L1 1Z"/>'
        '<path class="atlas-region" fill-rule="evenodd" data-allen-id="10" '
        'data-beryl-id="10" data-cosmos-id="10" d="M1 0L2 0L2 1Z"/>'
    )
    source = {
        "surface_labels": {"sha256": "a" * 64},
        "legacy_top": {"sha256": "b" * 64},
    }
    generator = {"commit": "c" * 40, "dirty": False}

    report = build_report(
        plane,
        _regions(),
        legacy,
        tolerances_um=(12.5,),
        created_at="2026-08-27T00:00:00Z",
        source=source,
        generator=generator,
    )

    assert report["format"] == FORMAT
    assert report["review_record_format"] == REVIEW_FORMAT
    assert report["status"].startswith("local review evidence only")
    assert [item["id"] for item in report["candidates"]] == [
        "reconstructed-exact",
        "coverage-12.5um",
    ]
    assert all(item["metrics"] for item in report["candidates"])
    assert report["inventory"]["only_in_candidate"] == []
    assert [criterion["id"] for criterion in report["review_criteria"]] == [
        "boundary_continuity",
        "smoothing_quality",
        "anatomical_shape",
    ]
    assert "needs-refinement" in report["disposition_options"]
    assert report["decision_rule"]["promotion"].startswith(
        "The result is a recommendation"
    )


def test_ten_micrometre_report_names_source_resolution_explicitly() -> None:
    plane = np.zeros((8, 8), dtype=np.int32)
    plane[1:7, 1:4] = 4
    plane[1:7, 4:7] = 1
    report = build_report(
        plane,
        _regions(),
        '<path class="atlas-region" fill-rule="evenodd" data-allen-id="-10" '
        'data-beryl-id="-10" data-cosmos-id="-10" d="M0 0L1 0L1 1Z"/>',
        tolerances_um=(5,),
        created_at="2026-08-27T00:00:00Z",
        source={
            "surface_labels": {"sha256": "a" * 64},
            "legacy_top": {"sha256": "b" * 64},
        },
        generator={"commit": "c" * 40, "dirty": False},
        resolution_um=10,
    )

    assert report["provenance"]["resolution_um"] == 10
    assert [item["id"] for item in report["candidates"]] == [
        "reconstructed-exact-10um",
        "coverage-5um-10um",
    ]
    assert report["candidates"][0]["label"] == "Reconstructed exact 10 µm"


def test_self_contained_report_has_guided_three_answer_workflow() -> None:
    template = open("tools/top_reconstruction_lab/template.html").read()
    rendered = render_report(
        {"unsafe": "</script>", "format": FORMAT},
        template,
    )
    parser = _Parser()
    parser.feed(rendered.decode())

    assert b"Boundary continuity / holes" not in rendered  # labels are report-driven
    assert b"Prefer A" in rendered
    assert b"No meaningful difference" in rendered
    assert b"Needs another variant" in rendered
    assert b"Prefer B" in rendered
    assert b"Optional observation" in rendered
    assert b"Option A" in rendered and b"Option B" in rendered
    assert b"adaptive pairwise finalist" not in rendered  # prose stays concise
    assert b"<\\/script>" in rendered
    assert b"<script src=" not in rendered
