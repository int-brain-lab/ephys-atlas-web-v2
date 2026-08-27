from __future__ import annotations

import gzip
import hashlib
import json
from pathlib import Path

import pytest

from ephys_atlas_builder.schema_v1 import validate_schema_v1_document
import tools.projection_pack.build as projection_pack_build
from tools.projection_pack.build import (
    PINNED_STATIC_SOURCES,
    STATIC_LICENSE_EVIDENCE,
    STATIC_LICENSE_RELATIVE_PATH,
    PinnedStaticSource,
    build_projection_pack,
    normalize_static_fragment,
    validate_projection_pack,
)
from tools.svg_pack.build_sampled import build_sampled


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _registered_parent(root: Path, *, valid: bool = True) -> Path:
    native = root / "native"
    projections = {}
    for name, axis, plane_axes, shape, matrix in (
        (
            "coronal",
            "ap",
            ["ml", "dv"],
            [2, 3],
            [0, 10, 0, -10, -10, 0, 0, 100, 0, 0, -10, 10, 0, 0, 0, 1],
        ),
        (
            "sagittal",
            "ml",
            ["ap", "dv"],
            [2, 3],
            [10, 0, 0, -10, 0, -10, 0, 100, 0, 0, -10, 10, 0, 0, 0, 1],
        ),
        (
            "horizontal",
            "dv",
            ["ml", "ap"],
            [3, 3],
            [0, 10, 0, -10, 0, 0, -10, 100, -10, 0, 0, 10, 0, 0, 0, 1],
        ),
    ):
        slices = []
        world_row = {"ml": 0, "ap": 1, "dv": 2}[axis]
        for index in range(17):
            world = matrix[world_row * 4] * index + matrix[world_row * 4 + 3]
            slices.append(
                {
                    "slice_index": index,
                    "world_coordinate_um": world,
                    "paths": [
                        {
                            "atlas_ids": {"allen": -10, "beryl": -20, "cosmos": -30},
                            "fill_rule": "evenodd",
                            "d": "M0 0L1 0L1 1Z",
                        }
                    ],
                }
            )
        payload = {"projection": name, "slices": slices}
        rel = Path("packs") / "16" / name / "0.json.gz"
        encoded = gzip.compress(json.dumps(payload).encode(), mtime=0)
        target = native / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(encoded)
        projections[name] = {
            "fixed_world_axis": axis,
            "plane_axes": plane_axes,
            "slice_count": 17,
            "slice_shape": shape,
            "view_box": [-0.5, -0.5, shape[1], shape[0]],
            "plane_index_to_world_um": matrix,
            "world_to_plane_index": matrix,
            "pack_sets": {
                "16": {
                    "packs": [
                        {
                            "pack_index": 0,
                            "path": rel.as_posix(),
                            "bytes": len(encoded),
                            "sha256": _sha(encoded),
                        }
                    ]
                }
            },
        }
    validation = {
        "topology_valid": valid,
        "coverage_valid": True,
        "background_topology_valid": True,
        "adjacency_mismatches": 0,
        "invalid_geometries": 0,
        "missing_atlas_ids": [],
        "multiply_covered_voxels": 0,
        "uncovered_voxels": 0,
        "sentinel_max_error_um": 0,
    }
    native.mkdir(parents=True, exist_ok=True)
    (native / "manifest.json").write_text(
        json.dumps(
            {
                "format": "anatomy-pack-v2",
                "pack_id": "synthetic-bilateral-parent",
                "coordinate_system": {"units": "um"},
                "projections": projections,
                "source": {
                    "hemisphere": "bilateral",
                    "resolution_um": 10,
                    "region_ids": {"domain": "signed_allen_atlas_id"},
                },
                "provenance": {},
                "validation": validation,
                "synchronization_sentinels": [{"name": "one"}, {"name": "two"}],
            }
        )
    )
    sampled = root / "sampled"
    build_sampled(native, sampled, generator_commit="abcdef0")
    return sampled


def _catalog(path: Path) -> None:
    path.write_text(
        json.dumps(
            {
                "schema_version": "1.0",
                "format": "ibl-atlas-regions-v1",
                "atlas": "synthetic",
                "mappings": {
                    "allen": [
                        {
                            "idx": 0,
                            "atlas_id": 0,
                            "mapped_atlas_ids": {"allen": 0, "beryl": 0, "cosmos": 0},
                        },
                        {
                            "idx": 1,
                            "atlas_id": -10,
                            "mapped_atlas_ids": {
                                "allen": -10,
                                "beryl": -110,
                                "cosmos": -210,
                            },
                        },
                        {
                            "idx": 2,
                            "atlas_id": -20,
                            "mapped_atlas_ids": {
                                "allen": -20,
                                "beryl": -20,
                                "cosmos": -220,
                            },
                        },
                        {
                            "idx": 3,
                            "atlas_id": -30,
                            "mapped_atlas_ids": {
                                "allen": -30,
                                "beryl": -130,
                                "cosmos": -30,
                            },
                        },
                    ],
                    "beryl": [{"idx": 0, "atlas_id": 0}],
                    "cosmos": [{"idx": 0, "atlas_id": 0}],
                },
            }
        )
    )


def _static(path: Path, count: int, *, unsafe: bool = False) -> None:
    fragment = (
        '<path class="allen_region_1 beryl_region_2 cosmos_region_3" d="M0 0L1 0L1 1Z"/>'
        * count
    )
    if unsafe:
        fragment += "<script>alert(1)</script>"
    path.write_text(json.dumps({"0": fragment}, separators=(",", ":")))


def _inputs(
    root: Path, *, valid_parent: bool = True
) -> tuple[Path, Path, dict[str, Path]]:
    registered = _registered_parent(root, valid=valid_parent)
    catalog = root / "regions.json"
    _catalog(catalog)
    sources = {"top": root / "top.json", "swanson": root / "swanson.json"}
    _static(sources["top"], 114)
    _static(sources["swanson"], 808)
    return registered, catalog, sources


def test_projection_pack_is_deterministic_and_complete(tmp_path: Path) -> None:
    registered, catalog, sources = _inputs(tmp_path)
    outputs = [tmp_path / "first", tmp_path / "second"]
    manifests = [
        build_projection_pack(
            registered,
            catalog,
            sources,
            output,
            created_at="2026-08-22T00:00:00Z",
            generator_commit="abcdef0",
            static_mode="synthetic-fixture",
        )
        for output in outputs
    ]
    assert manifests[0] == manifests[1]
    assert manifests[0]["pack_id"].startswith("synthetic-atlas-projections-")
    assert [projection["id"] for projection in manifests[0]["projections"]] == [
        "coronal",
        "sagittal",
        "horizontal",
        "top",
        "swanson",
    ]
    assert sorted(
        path.relative_to(outputs[0]) for path in outputs[0].rglob("*") if path.is_file()
    ) == sorted(
        path.relative_to(outputs[1]) for path in outputs[1].rglob("*") if path.is_file()
    )
    for first in (path for path in outputs[0].rglob("*") if path.is_file()):
        assert (
            first.read_bytes()
            == (outputs[1] / first.relative_to(outputs[0])).read_bytes()
        )

    for projection in manifests[0]["projections"][:3]:
        index_resource = projection["resource_index"]["resource"]
        encoded = (outputs[0] / index_resource["path"]).read_bytes()
        assert len(encoded) == index_resource["bytes"]
        assert _sha(encoded) == index_resource["sha256"]
        index = json.loads(gzip.decompress(encoded))
        validate_schema_v1_document(index, "registered-svg-resource-index.schema.json")
        assert [
            slice_index
            for entry in index["resources"]
            for slice_index in entry["slice_indices"]
        ] == projection["display_slices"]
        parent_projection = json.loads((registered / "manifest.json").read_text())[
            "projections"
        ][projection["id"]]
        assert projection["slice_shape"] == list(
            reversed(parent_projection["slice_shape"])
        )

    static = {
        projection["id"]: projection for projection in manifests[0]["projections"][3:]
    }
    for name, count in (("top", 114), ("swanson", 808)):
        resource = static[name]["fragment"]["resource"]
        fragment = gzip.decompress(
            (outputs[0] / resource["path"]).read_bytes()
        ).decode()
        assert fragment.count("<path ") == count
        assert 'data-allen-id="-10"' in fragment
        assert 'data-beryl-id="-20"' in fragment
        assert 'data-cosmos-id="-30"' in fragment
        assert "allen_region_" not in fragment
    assert validate_projection_pack(outputs[0]) == manifests[0]
    assert all(
        not source.get("path", "").startswith("/")
        for source in manifests[0]["provenance"]["sources"]
    )


def test_complete_pack_validator_rejects_tampering_and_undeclared_files(
    tmp_path: Path,
) -> None:
    registered, catalog, sources = _inputs(tmp_path)
    output = tmp_path / "pack"
    manifest = build_projection_pack(
        registered,
        catalog,
        sources,
        output,
        created_at="2026-08-22T00:00:00Z",
        generator_commit="abcdef0",
        static_mode="synthetic-fixture",
    )
    top = next(
        projection
        for projection in manifest["projections"]
        if projection["id"] == "top"
    )
    resource_path = output / top["fragment"]["resource"]["path"]
    original = resource_path.read_bytes()
    resource_path.write_bytes(original + b"corrupt")
    with pytest.raises(ValueError, match="integrity mismatch"):
        validate_projection_pack(output)
    resource_path.write_bytes(original)
    (output / "undeclared.txt").write_text("not part of the immutable graph")
    with pytest.raises(ValueError, match="file graph differs"):
        validate_projection_pack(output)


def test_static_normalization_rejects_markup_and_unknown_legacy_ids(
    tmp_path: Path,
) -> None:
    catalog = tmp_path / "regions.json"
    _catalog(catalog)
    crosswalk = {
        "allen": {1: -10},
        "beryl": {2: -20},
        "cosmos": {3: -30},
    }
    with pytest.raises(ValueError, match="content other than paths|unsupported markup"):
        normalize_static_fragment(
            '<path class="allen_region_1 beryl_region_2 cosmos_region_3" d="M0 0Z"/><script/>',
            crosswalk,
        )
    with pytest.raises(ValueError, match="unknown allen"):
        normalize_static_fragment(
            '<path class="allen_region_99 beryl_region_2 cosmos_region_3" d="M0 0Z"/>',
            crosswalk,
        )


def test_production_static_ingestion_requires_authorized_license_and_pinned_bytes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    registered, catalog, sources = _inputs(tmp_path)
    with monkeypatch.context() as context:
        context.setattr(
            projection_pack_build,
            "STATIC_LICENSE_RELATIVE_PATH",
            Path("LICENSES/missing-static-asset-license.txt"),
        )
        with pytest.raises(ValueError, match="license evidence is missing"):
            build_projection_pack(
                registered,
                catalog,
                sources,
                tmp_path / "missing-license",
                created_at="2026-08-22T00:00:00Z",
                generator_commit="abcdef0",
            )
    with pytest.raises(ValueError, match="not the authorized record"):
        build_projection_pack(
            registered,
            catalog,
            sources,
            tmp_path / "wrong-license",
            created_at="2026-08-22T00:00:00Z",
            generator_commit="abcdef0",
            license_evidence="confirmed by repository owner",
        )
    with pytest.raises(ValueError, match="pinned evidence"):
        build_projection_pack(
            registered,
            catalog,
            sources,
            tmp_path / "wrong-bytes",
            created_at="2026-08-22T00:00:00Z",
            generator_commit="abcdef0",
            license_evidence=STATIC_LICENSE_EVIDENCE,
        )


def test_production_pack_embeds_the_exact_authorized_mit_notice(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    registered, catalog, sources = _inputs(tmp_path)
    for name, source in sources.items():
        content = source.read_bytes()
        monkeypatch.setitem(
            PINNED_STATIC_SOURCES,
            name,
            PinnedStaticSource(
                len(content),
                _sha(content),
                114 if name == "top" else 808,
            ),
        )

    output = tmp_path / "production"
    manifest = build_projection_pack(
        registered,
        catalog,
        sources,
        output,
        created_at="2026-08-27T00:00:00Z",
        generator_commit="abcdef0",
    )

    notice = manifest["provenance"]["recipe"]["license_notice"]
    resource = notice["resource"]
    assert notice["format"] == "ibl-static-asset-license-v1"
    assert resource["path"] == STATIC_LICENSE_RELATIVE_PATH.as_posix()
    assert resource["codec"]["name"] == "none"
    assert (output / resource["path"]).read_bytes() == (
        Path(__file__).resolve().parents[1] / STATIC_LICENSE_RELATIVE_PATH
    ).read_bytes()
    static_sources = manifest["provenance"]["sources"][-2:]
    assert all(
        source["license"] == STATIC_LICENSE_EVIDENCE for source in static_sources
    )
    assert validate_projection_pack(output) == manifest

    notice_path = output / resource["path"]
    notice_path.write_bytes(notice_path.read_bytes() + b"\nmodified")
    with pytest.raises(ValueError, match="resource integrity mismatch"):
        validate_projection_pack(output)


def test_top_review_mode_is_mixed_explicit_and_non_publishable(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    registered, catalog, sources = _inputs(tmp_path)
    top_bytes = sources["top"].read_bytes()
    monkeypatch.setitem(
        PINNED_STATIC_SOURCES,
        "top",
        PinnedStaticSource(len(top_bytes), _sha(top_bytes), 114),
    )
    output = tmp_path / "top-review"
    manifest = build_projection_pack(
        registered,
        catalog,
        sources,
        output,
        created_at="2026-08-27T00:00:00Z",
        generator_commit="abcdef0",
        static_mode="pinned-top-review",
    )
    assert manifest["pack_id"].startswith("review-atlas-projections-")
    recipe = manifest["provenance"]["recipe"]
    assert recipe["static_projection_modes"] == {
        "top": "pinned-review",
        "swanson": "synthetic-fixture",
    }
    sources_by_path = {
        source["path"]: source for source in manifest["provenance"]["sources"]
    }
    assert "license" not in sources_by_path["legacy/slices_top.json"]
    assert sources_by_path["legacy/slices_top.json"]["description"].startswith(
        "Pinned local-review-only"
    )
    assert "must not be published" in manifest["provenance"]["notes"][-1]


def test_rejects_registered_parent_that_failed_scientific_gates(tmp_path: Path) -> None:
    registered, catalog, sources = _inputs(tmp_path, valid_parent=False)
    with pytest.raises(ValueError, match="topology_valid"):
        build_projection_pack(
            registered,
            catalog,
            sources,
            tmp_path / "output",
            created_at="2026-08-22T00:00:00Z",
            generator_commit="abcdef0",
            static_mode="synthetic-fixture",
        )


def test_checked_in_production_pack_is_complete_authorized_and_sanitized() -> None:
    root = (
        Path(__file__).resolve().parents[1]
        / "web/public/atlas/projections/ibl-static-registered-v1"
    )
    manifest = validate_projection_pack(root)
    assert manifest["pack_id"] == "ibl-atlas-projections-2363b6958fbf"
    provenance = manifest["provenance"]
    assert provenance["builder"]["commit"] == (
        "f1deb17aee3e6879f4645fa7159ac04f2187046d"
    )
    assert provenance["recipe"]["static_source_mode"] == "pinned-curated"
    sources = {source["path"]: source for source in provenance["sources"]}
    assert sources["legacy/slices_top.json"]["sha256"] == (
        "4dc788df3da667c8dde5a9f1b0abc258715a916cb8609542bdd849f793815c30"
    )
    assert sources["legacy/slices_swanson.json"]["sha256"] == (
        "347ad18c2eb0fad1012d30432ff4abf8a09dc0acc0f33b57efbdd2790826acba"
    )

    projections = {
        projection["id"]: projection for projection in manifest["projections"]
    }
    for projection_id, path_count in (("top", 114), ("swanson", 808)):
        projection = projections[projection_id]
        fragment = gzip.decompress(
            (root / projection["fragment"]["resource"]["path"]).read_bytes()
        ).decode("utf-8")
        assert projection["path_count"] == path_count
        assert fragment.count("<path ") == path_count
        assert "_region_" not in fragment
        assert "<script" not in fragment
