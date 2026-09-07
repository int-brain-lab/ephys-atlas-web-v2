from copy import deepcopy
import json
from pathlib import Path

import pytest

from tools.mesh_pack import build_native_selected as selected
from tools.mesh_pack.build import _canonical
from tools.mesh_pack.build_native_review import digest


def test_approval_is_bound_to_exact_review_and_cannot_be_edited(tmp_path: Path):
    selection = selected.read_selection(selected.SELECTION)
    assert selection['accept_all_reviewed_assignments'] is True
    assert selection['component_count'] == sum(selection['movement_counts'].values()) == 1140
    assert selection['presentation_boundary']['threshold_um'] == 0
    assert selection['presentation_boundary']['on_plane_side'] == 'right'
    assert selection['classification_tolerance_um'] == .001
    assert selection['public_deployment_authorized'] is False
    selection['presentation_boundary']['on_plane_side'] = 'left'
    changed = tmp_path / 'changed.json'
    changed.write_text(json.dumps(selection))
    with pytest.raises(ValueError, match='selection SHA'):
        selected.read_selection(changed)


def test_selected_metadata_preserves_geometry_and_records_approval(monkeypatch):
    selection = selected.read_selection(selected.SELECTION)
    # Synthetic metadata only: never written as a real approved pack.
    manifest = {'pack_id': 'synthetic-review', 'purpose': 'review-only', 'components': [{'component_id': 0}],
        'geometry_id': 'synthetic', 'presentations': [{'presentation_id': 0}], 'builder': {'commit': 'old'},
        'lods': [{'resource': {'sha256': 'unchanged'}}], 'validation': {'report': {'path': 'validation-report.json'}}}
    report = {'pack_id': 'synthetic-review', 'evidence': {'builder_source_sha256': 'old-source',
        'components': [{'component_id': 0, 'proposed_movement': 'fixed', 'review_status': 'unreviewed'}]}}
    before_manifest, before_report = deepcopy(manifest), deepcopy(report)
    result, evidence = selected.selected_documents(manifest, report, selection, 'new-commit')
    assert result['purpose'] == 'production'
    assert result['presentation_boundary']['status'] == 'reviewed'
    for key in ['components', 'presentations', 'geometry_id', 'lods']:
        assert result[key] == manifest[key]
    assert result['builder']['commit'] == 'new-commit'
    assert evidence['evidence']['review_builder'] == manifest['builder']
    assert evidence['evidence']['components'][0]['accepted_movement'] == 'fixed'
    assert evidence['evidence']['components'][0]['review_status'] == 'accepted'
    assert result['validation']['report']['sha256'] == digest(_canonical(evidence))
    assert result['validation']['report']['bytes'] == len(_canonical(evidence))
    assert (manifest, report) == (before_manifest, before_report)
    assert (result, evidence) == selected.selected_documents(manifest, report, selection, 'new-commit')
    other, _ = selected.selected_documents(manifest, report, selection, 'different-commit')
    assert other['pack_id'] != result['pack_id']
    monkeypatch.setattr(selected.platform, 'machine', lambda: 'different-build-machine')
    other, _ = selected.selected_documents(manifest, report, selection, 'new-commit')
    assert other['pack_id'] != result['pack_id']


def test_selected_build_refuses_overwrite_and_wrong_review(tmp_path: Path):
    output = tmp_path / 'existing'
    output.mkdir()
    with pytest.raises(FileExistsError):
        selected.build(tmp_path, selected.SELECTION, output, commit='test')
    (tmp_path / 'manifest.json').write_text('{}')
    with pytest.raises(ValueError, match='review manifest SHA'):
        selected.build(tmp_path, selected.SELECTION, tmp_path / 'new', commit='test')
    assert not (tmp_path / 'new').exists()


def test_approved_build_requires_clean_linux_main(monkeypatch):
    monkeypatch.setattr(selected.platform, 'system', lambda: 'Darwin')
    with pytest.raises(ValueError, match='Linux'):
        selected.clean_linux_commit('abc')
    monkeypatch.setattr(selected.platform, 'system', lambda: 'Linux')
    for branch, head, dirty, message in [('other', 'abc', '', 'main'), ('main', 'other', '', 'main'), ('main', 'abc', ' M file', 'clean')]:
        answers = iter([branch, head, dirty])
        monkeypatch.setattr(selected.subprocess, 'check_output', lambda *args, **kwargs: next(answers))
        with pytest.raises(ValueError, match=message):
            selected.clean_linux_commit('abc')
