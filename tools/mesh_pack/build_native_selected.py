"""Build the D070 approved pack from exact, owner-reviewed native geometry bytes.

This is deterministic packaging, not a new geometry or movement calculation.
The original review graph and D042 rollback are never modified.
"""
from __future__ import annotations

import argparse
from collections import Counter
from copy import deepcopy
import json
from pathlib import Path
import platform
import subprocess

from .build import _canonical
from .build_native_review import digest
from .validate import validate_pack

ROOT = Path(__file__).resolve().parents[2]
SELECTION = ROOT / 'docs/data/NATIVE_3D_SELECTION.json'
SELECTION_SHA = '3dedc5e1a87757a3e2ffdb52bc0ea502083d289ceac98252b2a31afa3b57455b'


def read_selection(path: Path) -> dict:
    data = path.read_bytes()
    if digest(data) != SELECTION_SHA:
        raise ValueError('D070 selection SHA differs; a changed choice requires a new decision/build')
    return json.loads(data)


def clean_linux_commit(commit: str) -> None:
    if platform.system() != 'Linux':
        raise ValueError('approved native pack requires Linux; use the review builder for previews')
    def git(*args: str) -> str:
        return subprocess.check_output(['git', '-C', str(ROOT), *args], text=True).strip()
    if git('branch', '--show-current') != 'main' or git('rev-parse', 'HEAD') != commit:
        raise ValueError('approved native pack requires the exact checked-out main commit')
    if git('status', '--porcelain'):
        raise ValueError('approved native pack requires a clean worktree')


def selected_documents(manifest: dict, report: dict, selection: dict, commit: str) -> tuple[dict, dict]:
    """Preserve geometry and replace only explicitly approved identity/provenance."""
    selected = deepcopy(manifest)
    evidence = deepcopy(report)
    # Future builds must not reuse an immutable asset URL when build provenance changes.
    # The original v1 output on 3d52114 is preserved separately by the v5 bundle.
    environment = dict(system=platform.system(), machine=platform.machine(), python=platform.python_version())
    identity = dict(geometry=selection['geometry_resource_sha256'], selection=SELECTION_SHA, commit=commit, environment=environment)
    pack_id = f'ibl-native-d070-{digest(_canonical(identity))[:16]}'
    selected.update(pack_id=pack_id, purpose='production', presentation_boundary=selection['presentation_boundary'])
    selected['builder'] = dict(name='ibl-atlas-mesh-pack-builder', version='native-selected-v2', commit=commit,
        command='python -m tools.mesh_pack.build_native_selected --review <pinned-review> --selection docs/data/NATIVE_3D_SELECTION.json --output <new-output> --builder-commit <commit>')
    evidence.update(pack_id=pack_id, test_only=False)
    evidence['evidence'].update(
        purpose='production', artifact_maturity='validated-real-local', decision='D070',
        selection=selection, selection_sha256=SELECTION_SHA,
        review_manifest_sha256=selection['review_manifest_sha256'],
        review_report_sha256=selection['review_report_sha256'],
        review_builder=manifest['builder'],
        review_builder_source_sha256=report['evidence']['builder_source_sha256'],
        builder_source_sha256=digest(Path(__file__).read_bytes()),
        builder_commit=commit,
        environment=environment,
        presentation_rule='Original decoded ML < 0 is left; zero and positive are right (D070). No near-plane geometry adjustment.',
        approval_status='accepted',
    )
    for component in evidence['evidence']['components']:
        component['review_status'] = 'accepted'
        component['accepted_movement'] = component['proposed_movement']
    report_bytes = _canonical(evidence)
    descriptor = selected['validation']['report']
    descriptor.update(bytes=len(report_bytes), sha256=digest(report_bytes), codec=dict(name='none', decoded_bytes=len(report_bytes)))
    return selected, evidence


def build(review: Path, selection_path: Path, output: Path, *, commit: str) -> dict:
    if output.exists():
        raise FileExistsError(f'output must be new: {output}')
    selection = read_selection(selection_path)
    if digest((review / 'manifest.json').read_bytes()) != selection['review_manifest_sha256']:
        raise ValueError('review manifest SHA differs from owner-approved selection')
    manifest = validate_pack(review)
    report_path = manifest['validation']['report']['path']
    report_bytes = (review / report_path).read_bytes()
    if digest(report_bytes) != selection['review_report_sha256']:
        raise ValueError('review report SHA differs from owner-approved selection')
    report = json.loads(report_bytes)
    if not all(report['results'].values()) or manifest['purpose'] != 'review-only':
        raise ValueError('D070 requires the fully validated review-only source graph')
    lod = manifest['lods'][0]
    resource = (review / lod['resource']['path']).read_bytes()
    if digest(resource) != selection['geometry_resource_sha256']:
        raise ValueError('geometry SHA differs from owner-reviewed geometry')
    if (manifest['sources']['source_glb']['sha256'] != selection['source_glb_sha256']
            or manifest['geometry_policy'] != selection['geometry_policy']
            or len(manifest['components']) != selection['component_count']
            or lod['triangle_count'] != selection['triangle_count']
            or report['evidence']['proposal_sha256'] != selection['movement_proposal_sha256']
            or Counter(row['proposed_movement'] for row in report['evidence']['components']) != selection['movement_counts']):
        raise ValueError('reviewed source, geometry, or movement inventory differs')
    clean_linux_commit(commit)
    selected, evidence = selected_documents(manifest, report, selection, commit)
    # The compiler is metadata-only; numeric geometry bytes are reused verbatim.
    output.mkdir(parents=True)
    for name, data in [('manifest.json', _canonical(selected)), (report_path, _canonical(evidence)), (lod['resource']['path'], resource)]:
        with (output / name).open('xb') as stream:
            stream.write(data)
    validate_pack(output)
    return dict(pack_id=selected['pack_id'], triangles=lod['triangle_count'], components=len(selected['components']),
                manifest_bytes=len(_canonical(selected)), manifest_sha256=digest(_canonical(selected)), resource_sha256=digest(resource))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--review', type=Path, required=True)
    parser.add_argument('--selection', type=Path, default=SELECTION)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--builder-commit', required=True)
    args = parser.parse_args()
    print(json.dumps(build(args.review, args.selection, args.output, commit=args.builder_commit)))


if __name__ == '__main__':
    main()
