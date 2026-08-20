import gzip
import json
from pathlib import Path

import pytest

from tools.svg_pack import decode
from tools.svg_pack.build_sampled import build_sampled


def _parent(root: Path, *, mismatch: bool = False) -> None:
    projections = {}
    for name, axis, matrix in (
        ("coronal", "ap", [0, 10, 0, 0, -10, 0, 0, 100, 0, 0, -10, 0, 0, 0, 0, 1]),
        ("sagittal", "ml", [10, 0, 0, 0, 0, 10, 0, 0, 0, 0, -10, 0, 0, 0, 0, 1]),
        ("horizontal", "dv", [0, 10, 0, 0, 0, 0, -10, 0, 10, 0, 0, 0, 0, 0, 0, 1]),
    ):
        slices = []
        for index in range(17):
            world = matrix[{"ml": 0, "ap": 1, "dv": 2}[axis] * 4] * index + matrix[{"ml": 0, "ap": 1, "dv": 2}[axis] * 4 + 3]
            slices.append({"slice_index": index, "world_coordinate_um": world + (1 if mismatch and index == 8 else 0), "paths": [{"atlas_ids": {"allen": -1, "beryl": -1, "cosmos": -1}, "fill_rule": "evenodd", "d": "M0 0Z"}]})
        payload = {"projection": name, "slices": slices}
        rel = Path("packs") / "16" / name / "0.json.gz"
        target = root / rel
        target.parent.mkdir(parents=True)
        compressed = gzip.compress(json.dumps(payload).encode(), mtime=0)
        target.write_bytes(compressed)
        projections[name] = {"fixed_world_axis": axis, "plane_axes": ["ml", "dv"], "slice_count": 17, "slice_shape": [1, 1], "view_box": [-0.5, -0.5, 1, 1], "plane_index_to_world_um": matrix, "world_to_plane_index": matrix, "pack_sets": {"16": {"packs": [{"pack_index": 0, "path": rel.as_posix(), "bytes": len(compressed), "sha256": __import__("hashlib").sha256(compressed).hexdigest()}]}}}
    (root / "manifest.json").write_text(json.dumps({
        "format": "anatomy-pack-v2",
        "pack_id": "synthetic-parent",
        "coordinate_system": {"units": "um"},
        "projections": projections,
        "source": {},
        "provenance": {},
        "validation": {},
        "synchronization_sentinels": [{}, {}],
    }))


def test_sampled_corpus_has_explicit_80um_inventory_and_deterministic_bytes(tmp_path: Path):
    parent = tmp_path / "parent"
    _parent(parent)
    first = tmp_path / "first"
    second = tmp_path / "second"
    build_sampled(parent, first)
    build_sampled(parent, second)
    first_manifest = json.loads((first / "manifest.json").read_text())
    for projection in ("coronal", "sagittal", "horizontal"):
        indices = first_manifest["projections"][projection]["display_slice_indices"]
        assert indices
        assert all(right - left == 8 for left, right in zip(indices, indices[1:]))
    assert first_manifest["projections"]["coronal"]["lattice_anchor_slice_index"] == 10
    assert first_manifest["projections"]["coronal"]["display_slice_indices"] == [2, 10]
    assert sorted(p.relative_to(first) for p in first.rglob("*") if p.is_file()) == sorted(p.relative_to(second) for p in second.rglob("*") if p.is_file())
    for path in (first / "packs").rglob("*.gz"):
        assert path.read_bytes() == (second / path.relative_to(first)).read_bytes()
    pack_path = next((first / "packs").rglob("*.isvg.gz"))
    decoded = decode(gzip.decompress(pack_path.read_bytes()))
    assert decoded.fragments[0].svg.startswith('<path class="atlas-region"')


def test_rejects_affine_world_mismatch(tmp_path: Path):
    parent = tmp_path / "parent"
    _parent(parent, mismatch=True)
    with pytest.raises(ValueError, match="affine/world mismatch"):
        build_sampled(parent, tmp_path / "output")


def test_refuses_existing_or_nested_output(tmp_path: Path):
    parent = tmp_path / "parent"
    _parent(parent)
    with pytest.raises(ValueError, match="inside"):
        build_sampled(parent, parent / "child")
