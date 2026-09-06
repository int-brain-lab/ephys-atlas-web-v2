from copy import deepcopy

import pytest

from tools.mesh_pack.components import audit_surface
from tools.mesh_pack.propose_movement import propose


def fixture(bounds):
    surfaces = []
    for i, (low, high) in enumerate(bounds):
        result = audit_surface([[low,0,0], [high,1,0], [high,0,1]], [[0,1,2]], connectivity='edge', tolerance_um=0.001)
        surfaces.append({'source_allen_id': i+1, 'variants': [{'connectivity': 'edge', 'tolerance_um': 0.001, **result}]})
    return {'format': 'native-mesh-component-audit-v1', 'purpose': 'review-only',
            'source_sha256': 'synthetic', 'baseline_manifest_sha256': 'synthetic', 'surfaces': surfaces}


def test_suggestions_do_not_relabel_geometry_or_approve_asymmetric_components():
    audit = fixture([[-10,-1], [1,10], [-10,10], [-0.002,10], [-10,0.002], [0,10]])
    original = deepcopy(audit)
    result = propose(audit, tolerance_um=0.001, dominant_extent_fraction=0.9)
    assert result['summary'] == {'fixed': 1, 'left': 2, 'right': 2, 'unresolved': 1}
    assert result['components'][3]['geometric_classification'] == 'neutral'
    assert result['components'][3]['proposed_movement'] == 'right'
    assert result['components'][4]['proposed_movement'] == 'left'
    assert all(c['review_status'] == 'unreviewed' for c in result['components'])
    assert audit == original


def test_review_threshold_changes_suggestion_without_changing_classification():
    audit = fixture([[-1,9]])
    for threshold, expected in [(0.9, 'right'), (0.91, 'fixed')]:
        result = propose(audit, tolerance_um=0.001, dominant_extent_fraction=threshold)
        assert result['components'][0]['proposed_movement'] == expected
        assert result['components'][0]['geometric_classification'] == 'neutral'


@pytest.mark.parametrize('threshold', [0.5, 1.1, float('nan')])
def test_invalid_review_threshold_is_rejected(threshold):
    with pytest.raises(ValueError, match='fraction'):
        propose(fixture([]), tolerance_um=0.001, dominant_extent_fraction=threshold)


def test_missing_variant_duplicate_identity_and_inconsistent_bounds_fail_closed():
    audit = fixture([[-1,1]])
    with pytest.raises(ValueError, match='exactly one'):
        propose(audit, tolerance_um=0.1, dominant_extent_fraction=0.9)
    audit['surfaces'].append(deepcopy(audit['surfaces'][0]))
    with pytest.raises(ValueError, match='duplicate'):
        propose(audit, tolerance_um=0.001, dominant_extent_fraction=0.9)
    audit['surfaces'].pop()
    audit['surfaces'][0]['variants'][0]['components'][0]['classification'] = 'left'
    with pytest.raises(ValueError, match='classification'):
        propose(audit, tolerance_um=0.001, dominant_extent_fraction=0.9)


def test_cli_hash_binding_exclusive_output_and_deterministic_bytes(tmp_path, monkeypatch):
    import hashlib
    import json
    import sys
    from tools.mesh_pack.propose_movement import main

    source = tmp_path / 'audit.json'
    data = json.dumps(fixture([[-1,1], [-0.002,10]])).encode()
    source.write_bytes(data)
    digest = hashlib.sha256(data).hexdigest()
    output = tmp_path / 'proposal.json'

    def arguments(target, sha):
        monkeypatch.setattr(sys, 'argv', ['propose_movement', '--audit', str(source),
                            '--audit-sha256', sha, '--tolerance-um', '0.001',
                            '--dominant-extent-fraction', '0.9', '--output', str(target)])

    arguments(output, 'wrong')
    with pytest.raises(ValueError, match='SHA-256'):
        main()
    assert not output.exists()
    arguments(output, digest)
    main()
    before = output.read_bytes()
    assert json.loads(before)['audit_sha256'] == digest
    with pytest.raises(FileExistsError):
        main()
    assert output.read_bytes() == before
    repeat = tmp_path / 'repeat.json'
    arguments(repeat, digest)
    main()
    assert repeat.read_bytes() == before
