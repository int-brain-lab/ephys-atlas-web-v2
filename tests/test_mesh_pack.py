from __future__ import annotations

import gzip
import json
import shutil
import struct
from copy import deepcopy
from pathlib import Path

import pytest
from ephys_atlas_builder.schema_v1 import validate_schema_v1_document
from ephys_atlas_builder.validate import ValidationError

from tools.mesh_pack.active_ids import build_active_ids
from tools.mesh_pack.binary import encode_raw_lod, inspect_lod
from tools.mesh_pack.build import build_pack
from tools.mesh_pack.canonical_metadata import _ancestor_source
from tools.mesh_pack.canonical_overrides import (
    validate_override_ids,
    voxel_face_surface,
)
from tools.mesh_pack.geometry import split_and_cap_hemispheres
from tools.mesh_pack.ontology import resolve_mapping, select_grey_matter_source_ids
from tools.mesh_pack.synthetic import build_synthetic_glb
from tools.mesh_pack.validate import validate_pack
from tools.svg_pack.codec import SvgFragment, SvgPack, encode

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
    expected_files = sorted(
        path.relative_to(FIXTURE / "pack")
        for path in (FIXTURE / "pack").rglob("*")
        if path.is_file()
    )
    assert expected_files == sorted(
        path.relative_to(output) for path in output.rglob("*") if path.is_file()
    )
    for relative in expected_files:
        assert (output / relative).read_bytes() == (
            FIXTURE / "pack" / relative
        ).read_bytes()


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


def test_active_mesh_inventory_is_derived_from_projection_fragments(
    tmp_path: Path,
) -> None:
    pack = tmp_path / "projection"
    (pack / "packs/coronal").mkdir(parents=True)
    (pack / "manifest.json").write_text(json.dumps({"pack_id": "projection-pack"}))
    fragment = SvgFragment(
        0, 0, '<path data-allen-id="-315"/><path data-allen-id="1009"/>'
    )
    encoded = encode(SvgPack("coronal", "sample", (fragment,)))
    (pack / "packs/coronal/sample.isvg.gz").write_bytes(gzip.compress(encoded, mtime=0))
    document = build_active_ids(pack, tmp_path / "active.json")
    assert document["allen_ids"] == [315, 545, 1009]
    assert document["canonical_additions"] == [545]
    assert document["sampled_resource_count"] == 1


def test_canonical_centroid_assignment_uses_nearest_active_ancestor() -> None:
    rows = {
        8: {"parent_id": 997},
        315: {"parent_id": 8},
        927: {"parent_id": 315},
    }
    assert _ancestor_source(927, {315, 8}, rows) == 315
    assert _ancestor_source(927, {927, 315}, rows) == 927
    assert _ancestor_source(997, {315}, rows) is None


def test_canonical_override_scope_is_exactly_owner_allowlisted() -> None:
    validate_override_ids({222, 763, 927, 526322264, 599626923})
    with pytest.raises(ValueError, match="exactly the owner-approved"):
        validate_override_ids({763, 927, 526322264, 599626923})
    with pytest.raises(ValueError, match="exactly the owner-approved"):
        validate_override_ids({222, 763, 927, 315, 526322264, 599626923})


def test_voxel_face_override_is_closed_deterministic_and_uses_world_voxel_edges() -> (
    None
):
    import numpy as np

    mask = np.zeros((2, 2, 2), dtype=np.bool_)
    mask[0, 0, 0] = True
    first_positions, first_triangles = voxel_face_surface(mask, (10, 20, 30))
    second_positions, second_triangles = voxel_face_surface(mask, (10, 20, 30))
    assert np.array_equal(first_positions, second_positions)
    assert np.array_equal(first_triangles, second_triangles)
    assert first_positions.shape == (8, 3)
    assert first_triangles.shape == (12, 3)
    edges: dict[tuple[int, int], int] = {}
    for triangle in first_triangles:
        for left, right in zip(triangle, np.roll(triangle, -1)):
            edge = tuple(sorted((int(left), int(right))))
            edges[edge] = edges.get(edge, 0) + 1
    assert set(edges.values()) == {2}
    assert np.allclose(first_positions.min(axis=0), [-5544, 5295, 27])
    assert np.allclose(first_positions.max(axis=0), [-5534, 5305, 37])


def test_voxel_face_override_separates_diagonal_contact_sheets() -> None:
    import numpy as np

    mask = np.zeros((2, 2, 1), dtype=np.bool_)
    mask[0, 0, 0] = True
    mask[1, 1, 0] = True
    positions, triangles = voxel_face_surface(mask, (0, 0, 0))
    edges: dict[tuple[int, int], int] = {}
    for triangle in triangles:
        for left, right in zip(triangle, np.roll(triangle, -1)):
            edge = tuple(sorted((int(left), int(right))))
            edges[edge] = edges.get(edge, 0) + 1
    assert positions.shape == (16, 3)
    assert triangles.shape == (24, 3)
    assert set(edges.values()) == {2}


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


def test_meshopt_eam3_inspection_validates_blocks_and_exposes_counts() -> None:
    header = json.dumps(
        {
            "encoding": "meshopt-quantized-v1",
            "chunks": [
                {
                    "hemisphere": "left",
                    "vertex_count": 3,
                    "index_count": 3,
                    "blocks": {
                        "vertices": {
                            "byte_offset": 0,
                            "byte_length": 1,
                            "codec": "meshopt-vertex",
                            "stride": 8,
                        },
                        "normals": {
                            "byte_offset": 1,
                            "byte_length": 1,
                            "codec": "meshopt-oct",
                            "stride": 4,
                        },
                        "indices": {
                            "byte_offset": 2,
                            "byte_length": 1,
                            "codec": "meshopt-index",
                            "stride": 4,
                        },
                    },
                    "ranges": [],
                }
            ],
        },
        separators=(",", ":"),
    ).encode()
    payload_offset = (12 + len(header) + 3) // 4 * 4
    encoded = bytearray(payload_offset + 3)
    encoded[:4] = b"EAM3"
    struct.pack_into("<II", encoded, 4, 1, len(header))
    encoded[12 : 12 + len(header)] = header
    inspected = inspect_lod(encoded)
    assert inspected["chunks"][0]["arrays"]["indices"]["count"] == 3
    encoded.pop()
    with pytest.raises(ValueError, match="indices block"):
        inspect_lod(encoded)


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


def test_graph_validation_checks_decoded_size_and_decoder_contract(
    tmp_path: Path,
) -> None:
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
    manifest["lods"][0]["decoder"].update(
        {"encoding": "meshopt-quantized-v1", "position_bits": 14, "normal_bits": 8}
    )
    manifest_path.write_text(json.dumps(manifest))
    with pytest.raises(ValueError, match="decoder contract"):
        validate_pack(pack)
    decoded = gzip.decompress((FIXTURE / "pack/default.eam3.gz").read_bytes())
    assert inspect_lod(decoded)["chunks"][0]["hemisphere"] == "left"
