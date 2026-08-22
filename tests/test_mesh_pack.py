from __future__ import annotations

import gzip
import json
import shutil
from copy import deepcopy
from pathlib import Path

import pytest

from ephys_atlas_builder.schema_v1 import validate_schema_v1_document
from ephys_atlas_builder.validate import ValidationError
from tools.mesh_pack.binary import encode_raw_lod, inspect_lod
from tools.mesh_pack.build import build_pack
from tools.mesh_pack.geometry import split_and_cap_hemispheres
from tools.mesh_pack.ontology import resolve_mapping, select_grey_matter_source_ids
from tools.mesh_pack.synthetic import build_synthetic_glb
from tools.mesh_pack.validate import validate_pack

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "fixtures/mesh-pack-v1"


def test_committed_mesh_pack_is_schema_valid_and_has_a_complete_graph() -> None:
    manifest = validate_pack(FIXTURE / "pack")
    validate_schema_v1_document(manifest, "mesh-pack.schema.json")
    assert manifest["purpose"] == "test-only"
    assert manifest["format"] == "atlas-mesh-pack-v1"
    assert manifest["default_lod_id"] == "default"
    assert manifest["upgrade_lod_id"] is None
    assert manifest["reference_space_id"] == "allen-ccf-2017"


def test_synthetic_glb_and_pack_rebuild_byte_for_byte(tmp_path: Path) -> None:
    source = tmp_path / "source"
    shutil.copytree(FIXTURE / "source", source)
    rebuilt_glb = tmp_path / "source.glb"
    build_synthetic_glb(source / "source-spec.json", rebuilt_glb)
    assert rebuilt_glb.read_bytes() == (source / "source.glb").read_bytes()
    rebuilt_glb.replace(source / "source.glb")
    output = tmp_path / "pack"
    build_pack(source, output)
    expected_files = sorted(path.relative_to(FIXTURE / "pack") for path in (FIXTURE / "pack").rglob("*") if path.is_file())
    assert expected_files == sorted(path.relative_to(output) for path in output.rglob("*") if path.is_file())
    for relative in expected_files:
        assert (output / relative).read_bytes() == (FIXTURE / "pack" / relative).read_bytes()


def test_clipping_retains_exact_midline_caps_and_bilateral_half_spaces() -> None:
    spec = json.loads((FIXTURE / "source/source-spec.json").read_text())["surfaces"][0]
    split = split_and_cap_hemispheres(spec["positions_um"], spec["triangles"])
    assert split.intersection_loop_count == 1
    assert split.open_intersection_component_count == 0
    assert split.left.surface_triangle_count == split.right.surface_triangle_count == 4
    assert split.left.cap_triangle_count == split.right.cap_triangle_count == 2
    assert all(point[0] <= 0 for point in split.left.positions)
    assert all(point[0] >= 0 for point in split.right.positions)


def test_clipping_rejects_open_midline_paths_but_can_record_them() -> None:
    positions = [[-1, 0, 0], [1, 0, 0], [-1, 1, 0]]
    with pytest.raises(ValueError, match="open or branching"):
        split_and_cap_hemispheres(positions, [[0, 1, 2]])
    result = split_and_cap_hemispheres(positions, [[0, 1, 2]], require_closed=False)
    assert result.open_intersection_component_count == 1
    assert result.intersection_loop_count == 0


def test_ontology_scope_is_deepest_active_grey_and_null_mapping_stays_null() -> None:
    catalog = json.loads((FIXTURE / "source/catalog.json").read_text())
    scope = select_grey_matter_source_ids({8, 315, 1009}, catalog)
    assert scope["renderable_ids"] == {315}
    assert scope["excluded_non_grey_active_ids"] == {1009}
    assert resolve_mapping(315, "beryl", catalog) is None
    assert resolve_mapping(315, "cosmos", catalog) == 315


def test_manifest_enforces_signed_bilateral_and_bounds_semantics() -> None:
    manifest = json.loads((FIXTURE / "pack/manifest.json").read_text())
    left, right = manifest["regions"]
    assert (left["signed_allen_id"], right["signed_allen_id"]) == (-315, 315)
    assert left["mappings"]["beryl"] is right["mappings"]["beryl"] is None
    broken = deepcopy(manifest)
    broken["regions"][0]["hemisphere"] = "right"
    with pytest.raises(ValidationError, match="signed Allen identity"):
        validate_schema_v1_document(broken, "mesh-pack.schema.json")
    broken = deepcopy(manifest)
    broken["regions"][1]["centroid_um"][0] = 3
    with pytest.raises(ValidationError, match="centroid or bounds"):
        validate_schema_v1_document(broken, "mesh-pack.schema.json")


def test_raw_eam3_container_rejects_identity_version_and_ranges() -> None:
    encoded = encode_raw_lod([])
    assert inspect_lod(encoded)["encoding"] == "raw-v1"
    corrupt = bytearray(encoded)
    corrupt[0] = 0
    with pytest.raises(ValueError, match="magic"):
        inspect_lod(corrupt)
    corrupt = bytearray(encoded)
    corrupt[4] = 2
    with pytest.raises(ValueError, match="version"):
        inspect_lod(corrupt)
    with pytest.raises(ValueError, match="truncated"):
        inspect_lod(encoded[:8])


def _copied_pack(tmp_path: Path) -> Path:
    target = tmp_path / "pack"
    shutil.copytree(FIXTURE / "pack", target)
    return target


def test_graph_validation_rejects_missing_and_undeclared_files(tmp_path: Path) -> None:
    pack = _copied_pack(tmp_path)
    (pack / "default.eam3.gz").unlink()
    with pytest.raises(FileNotFoundError, match="missing"):
        validate_pack(pack)
    pack = _copied_pack(tmp_path / "second")
    (pack / "undeclared.bin").write_bytes(b"x")
    with pytest.raises(ValueError, match="undeclared"):
        validate_pack(pack)


def test_graph_validation_rejects_size_and_hash_mismatches(tmp_path: Path) -> None:
    pack = _copied_pack(tmp_path)
    resource = pack / "default.eam3.gz"
    resource.write_bytes(resource.read_bytes() + b"x")
    with pytest.raises(ValueError, match="byte length"):
        validate_pack(pack)
    pack = _copied_pack(tmp_path / "second")
    resource = pack / "default.eam3.gz"
    data = bytearray(resource.read_bytes())
    data[-1] ^= 1
    resource.write_bytes(data)
    with pytest.raises(ValueError, match="SHA-256"):
        validate_pack(pack)


def test_graph_validation_checks_decoded_size_and_decoder_contract(tmp_path: Path) -> None:
    pack = _copied_pack(tmp_path)
    manifest_path = pack / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["lods"][0]["resource"]["codec"]["decoded_bytes"] += 1
    manifest_path.write_text(json.dumps(manifest))
    with pytest.raises(ValueError, match="decoded length"):
        validate_pack(pack)
    pack = _copied_pack(tmp_path / "second")
    manifest_path = pack / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["lods"][0]["decoder"].update({"encoding": "meshopt-quantized-v1", "position_bits": 14, "normal_bits": 8})
    manifest_path.write_text(json.dumps(manifest))
    with pytest.raises(ValueError, match="decoder contract"):
        validate_pack(pack)
    decoded = gzip.decompress((FIXTURE / "pack/default.eam3.gz").read_bytes())
    assert inspect_lod(decoded)["chunks"][0]["hemisphere"] == "left"
