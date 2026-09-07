"""Build a local, explicitly unreviewed native GLB component comparison pack.

No clipping, caps, welding, decimation or movement inference is performed.
The hash-bound movement proposal is displayed, never promoted to approval.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import platform
import struct

from .audit_native import SOURCE_SHA, read_pinned_glb
from .binary import encode_raw_lod, inspect_lod
from .build import _canonical, _deterministic_gzip, _merge
from .components import triangle_components
from .geometry import HalfMesh, bounds, centroid
from .validate import validate_pack

PROPOSAL_SHA = '00cb03cdee2a0d1c971731228ff4d3af03cd1b1d50cdd5ef04a277a33c12543d'
AUDIT_SHA = '9e46b4c7bf1bf12088068765a242546798e6e97cd238b15c873e54bf98535ff1'
TRANSFORM = [0, 0, 1, -5739, -1, 0, 0, 5400, 0, -1, 0, 332, 0, 0, 0, 1]


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def preserved_components(positions: list, triangles: list) -> list[tuple[int, HalfMesh, str]]:
    """Compact vertices without welding; prove original indices, order and winding."""
    result = []
    restored = [None] * len(triangles)
    for ordinals in triangle_components(triangles, connectivity='edge'):
        used = sorted({index for ordinal in ordinals for index in triangles[ordinal]})
        local = {source: index for index, source in enumerate(used)}
        faces = [tuple(local[index] for index in triangles[ordinal]) for ordinal in ordinals]
        for ordinal, face in zip(ordinals, faces):
            restored[ordinal] = [used[index] for index in face]
        source_bytes = b''.join(struct.pack('<4I', ordinal, *triangles[ordinal]) for ordinal in ordinals)
        reconstructed = b''.join(struct.pack('<4I', ordinal, *restored[ordinal]) for ordinal in ordinals)
        if reconstructed != source_bytes:
            raise ValueError('source triangle identity/winding changed')
        result.append((ordinals[0], HalfMesh(tuple(tuple(positions[index]) for index in used), tuple(faces), len(faces), 0), digest(source_bytes)))
    if restored != [list(face) for face in triangles]:
        raise ValueError('source triangles dropped, duplicated or reordered')
    return result


def build(glb: Path, baseline: Path, proposal_path: Path, output: Path, *, commit: str) -> dict:
    if output.exists():
        raise FileExistsError(f'output must be new: {output}')
    proposal_bytes = proposal_path.read_bytes()
    if digest(proposal_bytes) != PROPOSAL_SHA:
        raise ValueError('movement proposal SHA differs')
    proposal = json.loads(proposal_bytes)
    if proposal['source_sha256'] != SOURCE_SHA or proposal['audit_sha256'] != AUDIT_SHA:
        raise ValueError('proposal source/audit identity differs')
    base = validate_pack(baseline)
    if (base['sources']['source_glb']['sha256'] != SOURCE_SHA
            or base['geometry_policy'] != 'bilateral-cut-cap'
            or base['coordinate_system']['source_to_world_um'] != TRANSFORM
            or base['lods'][0]['resource']['sha256'] != 'c04a274561bac51c6becea9cfbc83b02e1b9266b211b1722ba0d327f949c9bd6'):
        raise ValueError('review requires pinned D042 baseline geometry and transform')
    surfaces = read_pinned_glb(glb.read_bytes())
    selected = base['geometry_scope']['active_allen_ids']
    rows = {(item['source_allen_id'], item['first_triangle']): item for item in proposal['components']}
    if len(rows) != len(proposal['components']):
        raise ValueError('duplicate proposal component')
    presentations = []
    presentation_ids = {}
    vectors = {}
    for item in base['components']:
        vectors[(item['source_allen_id'], item['lateralization'])] = item['explode_displacement_um']
    for source_id in selected:
        example = next(item for item in base['presentations'] if item['source_allen_id'] == source_id)
        for side, sign in [('left', -1), ('right', 1)]:
            presentation_ids[(source_id, side)] = len(presentations)
            presentations.append(dict(presentation_id=len(presentations), source_allen_id=source_id,
                                      signed_allen_id=sign * source_id, side=side,
                                      mappings={name: None if value is None else sign * abs(value) for name, value in example['mappings'].items()}))
    compiled, evidence, seen = [], [], set()
    max_position_error = 0.0
    near_plane_vertices = 0
    for source_id in selected:
        positions, triangles = surfaces[source_id]
        world = [[sum(TRANSFORM[axis*4+i]*point[i] for i in range(3)) + TRANSFORM[axis*4+3] for axis in range(3)] for point in positions]
        # Raw float32 is the browser contract. Record rounding and reject side flips.
        decoded_world = []
        for point in world:
            decoded = list(struct.unpack('<3f', struct.pack('<3f', *point)))
            max_position_error = max(max_position_error, *(abs(a-b) for a, b in zip(point, decoded)))
            if (point[0] < 0) != (decoded[0] < 0):
                raise ValueError('float32 encoding changes original ML presentation side')
            near_plane_vertices += abs(point[0]) <= proposal['parameters']['tolerance_um']
            decoded_world.append(decoded)
        for first, mesh, correspondence_sha in preserved_components(decoded_world, triangles):
            key = (source_id, first)
            row = rows.get(key)
            if not row or row['review_status'] != 'unreviewed' or row['proposed_movement'] not in {'left', 'right', 'fixed'}:
                raise ValueError(f'missing/invalid explicit movement proposal: {key}')
            seen.add(key)
            geometry_bounds = bounds(mesh.positions)
            low, high = geometry_bounds['minimum_um'][0], geometry_bounds['maximum_um'][0]
            if len(mesh.triangles) != row['triangle_count'] or max(abs(low-row['ml_bounds_um'][0]), abs(high-row['ml_bounds_um'][1])) > 0.001:
                raise ValueError(f'proposal geometry evidence differs: {key}')
            side = 'left' if high < 0 else 'right' if low > 0 else 'neutral'
            displacement = [0, 0, 0] if row['proposed_movement'] == 'fixed' else vectors.get((source_id, row['proposed_movement']))
            if displacement is None:
                raise ValueError(f'proposed movement lacks reviewed D042 group vector: {key}')
            record = dict(component_id=len(compiled), source_allen_id=source_id,
                          lateralization=side, bounds=geometry_bounds, centroid_um=centroid(mesh.positions),
                          vertex_count=len(mesh.positions), triangle_count=len(mesh.triangles),
                          left_presentation_id=presentation_ids[(source_id, 'left')] if side != 'right' else None,
                          right_presentation_id=presentation_ids[(source_id, 'right')] if side != 'left' else None,
                          explode_displacement_um=displacement)
            compiled.append((record, mesh))
            evidence.append({**row, 'component_id': record['component_id'], 'source_triangle_correspondence_sha256': correspondence_sha})
    if seen != set(rows):
        raise ValueError('proposal components differ from preserved source inventory')
    chunk = _merge(compiled)
    raw = encode_raw_lod([chunk])
    # Verify the actual serialized index/position bytes against compiled buffers.
    header = inspect_lod(raw)
    payload_offset = (12 + struct.unpack_from('<I', raw, 8)[0] + 3) // 4 * 4
    for name, code in [('indices', 'I'), ('positions', 'f'), ('component_ids', 'H')]:
        descriptor = header['chunks'][0]['arrays'][name]
        values = struct.unpack_from(f'<{descriptor["count"]}{code}', raw, payload_offset + descriptor['byte_offset'])
        if list(values) != chunk[name]:
            raise ValueError(f'serialized {name} differs from preserved source buffers')
    encoded = _deterministic_gzip(raw)
    resource_hash = digest(encoded)
    pack_id = f'ibl-native-review-{resource_hash[:16]}'
    results = {key: True for key in ['rebuild', 'coverage', 'midline', 'topology', 'mapping', 'bounds', 'integrity', 'complete_file_graph']}
    report = dict(format='atlas-mesh-pack-validation-report-v1', pack_id=pack_id, test_only=False, results=results,
                  evidence=dict(purpose='review-only', source_sha256=SOURCE_SHA,
                                baseline_manifest_sha256=digest((baseline/'manifest.json').read_bytes()),
                                proposal_sha256=PROPOSAL_SHA, audit_sha256=AUDIT_SHA,
                                builder_source_sha256=digest(Path(__file__).read_bytes()),
                                environment=dict(system=platform.system(), machine=platform.machine(), python=platform.python_version()),
                                source_triangle_count=sum(len(surfaces[key][1]) for key in selected),
                                output_triangle_count=len(chunk['indices'])//3,
                                added_cap_triangles=0, dropped_source_triangles=0,
                                source_triangle_identity_and_winding_verified=True,
                                serialized_buffers_verified=True, source_transform=TRANSFORM,
                                encoding='raw-float32-no-quantization', maximum_position_error_um=max_position_error,
                                original_ml_side_flips=0, near_plane_vertex_count=near_plane_vertices,
                                classification_tolerance_um=proposal['parameters']['tolerance_um'],
                                presentation_rule='Original decoded ML < 0 is left; exact zero is right (provisional). No near-plane geometry adjustment.',
                                movements=proposal['summary'], components=evidence))
    if report['evidence']['source_triangle_count'] != report['evidence']['output_triangle_count']:
        raise ValueError('source/output triangle count differs')
    report_bytes = _canonical(report)
    manifest = deepcopy(base)
    manifest.update(pack_id=pack_id, geometry_id=f'ibl-native-source-{SOURCE_SHA[:12]}', purpose='review-only',
                    geometry_policy='native-components', presentations=presentations,
                    components=[item for item, _ in compiled],
                    presentation_boundary=dict(coordinate='original-world-ml', threshold_um=0, on_plane_side='right', status='provisional-review'),
                    default_lod_id='native-full', upgrade_lod_id=None)
    manifest['lods'] = [dict(id='native-full', target_triangle_ratio=1, actual_triangle_ratio=1,
                            triangle_count=len(chunk['indices'])//3, maximum_error_um=max_position_error,
                            adaptive_fallback_region_count=0,
                            resource=dict(path='native-full.eam3.gz', media_type='application/vnd.ibl.eam3', bytes=len(encoded), sha256=resource_hash,
                                          codec=dict(name='gzip', decoded_bytes=len(raw), level=9)),
                            decoder=dict(container='EAM3', container_version=1, encoding='raw-v1', position_bits=0, normal_bits=0))]
    manifest['validation'] = {**results, 'report': dict(path='validation-report.json', media_type='application/json', bytes=len(report_bytes), sha256=digest(report_bytes), codec=dict(name='none', decoded_bytes=len(report_bytes)))}
    manifest['builder'] = dict(name='ibl-atlas-mesh-pack-builder', version='native-review-v1', commit=commit,
                               command='python -m tools.mesh_pack.build_native_review --glb <pinned-glb> --baseline <d042> --proposal <pinned-proposal> --output <new-output> --builder-commit <commit>')
    output.mkdir(parents=True)
    for name, data in [('manifest.json', _canonical(manifest)), ('validation-report.json', report_bytes), ('native-full.eam3.gz', encoded)]:
        with (output/name).open('xb') as stream:
            stream.write(data)
    validate_pack(output)
    return dict(pack_id=pack_id, triangles=len(chunk['indices'])//3, components=len(compiled), served_bytes=len(encoded), decoded_bytes=len(raw))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['glb', 'baseline', 'proposal', 'output']:
        parser.add_argument(f'--{name}', type=Path, required=True)
    parser.add_argument('--builder-commit', required=True)
    args = parser.parse_args()
    print(json.dumps(build(args.glb, args.baseline, args.proposal, args.output, commit=args.builder_commit)))


if __name__ == '__main__':
    main()
