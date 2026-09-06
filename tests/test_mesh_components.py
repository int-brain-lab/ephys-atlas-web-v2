from copy import deepcopy

import pytest

from tools.mesh_pack.components import audit_surface, triangle_components
from tools.mesh_pack.audit_native import read_pinned_glb


def test_connectivity_distinguishes_point_contact_and_retains_every_source_ordinal():
    faces = [[0, 1, 2], [2, 3, 4], [4, 3, 5], [6, 7, 8]]
    original = deepcopy(faces)
    assert triangle_components(faces, connectivity='edge') == [[0], [1, 2], [3]]
    assert triangle_components(faces, connectivity='vertex') == [[0, 1, 2], [3]]
    assert faces == original


def test_duplicate_coordinates_are_audited_without_welding():
    positions = [[-2,0,0], [-2,1,0], [-2,0,1]] * 2
    result = audit_surface(positions, [[0,1,2], [3,4,5]], connectivity='edge', tolerance_um=0)
    assert result['component_counts'] == {'left': 2}
    assert result['duplicate_position_vertex_count'] == 3
    assert result['degenerate_triangle_count'] == 0


@pytest.mark.parametrize(('ml', 'expected'), [([-2,-1,-1], 'left'), ([1,2,2], 'right'), ([-1,0,2], 'neutral'), ([0,0,0], 'ambiguous'), ([0,1,2], 'ambiguous'), ([-0.01,1,2], 'ambiguous')])
def test_classification_preserves_near_plane_ambiguity(ml, expected):
    result = audit_surface([[x,i,0] for i,x in enumerate(ml)], [[0,1,2]], connectivity='edge', tolerance_um=0.1)
    assert result['components'][0]['classification'] == expected


def test_centroid_sign_does_not_classify_asymmetric_spanning_component():
    result = audit_surface([[-0.2,0,0],[10,1,0],[10,0,1]], [[0,1,2]], connectivity='vertex', tolerance_um=0.1)
    assert result['component_counts'] == {'neutral': 1}


def test_degenerate_and_unused_inputs_remain_evidence():
    result = audit_surface([[1,0,0],[2,0,0],[3,0,0],[4,0,0]], [[0,1,2]], connectivity='edge', tolerance_um=0)
    assert result['degenerate_triangle_count'] == 1
    assert result['unused_vertex_count'] == 1


@pytest.mark.parametrize('tolerance', [-1, float('nan'), float('inf')])
def test_rejects_invalid_tolerances(tolerance):
    with pytest.raises(ValueError, match='tolerance'):
        audit_surface([], [], connectivity='edge', tolerance_um=tolerance)


def test_rejects_invalid_geometry_and_unpinned_source():
    with pytest.raises(ValueError, match='out of bounds'):
        audit_surface([[0,0,0]], [[0,1,2]], connectivity='edge', tolerance_um=0)
    with pytest.raises(ValueError, match='finite'):
        audit_surface([[float('nan'),0,0]], [], connectivity='edge', tolerance_um=0)
    with pytest.raises(ValueError, match='indices'):
        triangle_components([[0,-1,2]], connectivity='edge')
    with pytest.raises(ValueError, match='connectivity'):
        triangle_components([], connectivity='weld')
    with pytest.raises(ValueError, match='SHA mismatch'):
        read_pinned_glb(b'not the source')
