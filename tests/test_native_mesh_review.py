from pathlib import Path
import pytest

from tools.mesh_pack.build_native_review import build, preserved_components


def test_native_components_preserve_crossing_triangles_winding_and_duplicate_positions():
    positions = [[-1, 0, 0], [1, 0, 0], [0, 1, 0], [-1, 0, 0], [1, 0, 0], [0, -1, 0]]
    triangles = [[2, 1, 0], [3, 4, 5]]
    result = preserved_components(positions, triangles)
    assert [first for first, _, _ in result] == [0, 1]
    for (_, mesh, correspondence), triangle in zip(result, triangles):
        assert [[mesh.positions[index] for index in face] for face in mesh.triangles] == [[tuple(positions[index]) for index in triangle]]
        assert mesh.cap_triangle_count == 0
        assert mesh.surface_triangle_count == 1
        assert len(correspondence) == 64
    assert result == preserved_components(positions, triangles)


def test_native_review_refuses_existing_output_and_unpinned_proposal(tmp_path: Path):
    output = tmp_path / 'existing'
    output.mkdir()
    with pytest.raises(FileExistsError):
        build(tmp_path / 'missing', tmp_path / 'missing', tmp_path / 'missing', output, commit='synthetic')
    proposal = tmp_path / 'proposal.json'
    proposal.write_text('{}')
    with pytest.raises(ValueError, match='proposal SHA'):
        build(tmp_path / 'missing', tmp_path / 'missing', proposal, tmp_path / 'new', commit='synthetic')
    assert not (tmp_path / 'new').exists()
