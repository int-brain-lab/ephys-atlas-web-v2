"""Audit the pinned D042 source without generating a pack or choosing Q18 policy."""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import struct
from pathlib import Path

from .components import audit_surface
from .validate import validate_pack

SOURCE_SHA = "487a72172249acd4dba5b40c392fa8eb065b09bc8638f3195163c4cbf8f569db"
MANIFEST_SHA = "49d58f1893ce9978f41c13fd445f5ff2bd34b18b737aa5b763291b6774b34b2c"


def read_pinned_glb(data: bytes) -> dict[int, tuple[list, list]]:
    """Read this exact GLB's indexed, untransformed meshes; reject other inputs."""
    if len(data) != 96_622_012 or hashlib.sha256(data).hexdigest() != SOURCE_SHA:
        raise ValueError("pinned source GLB size/SHA mismatch")
    length = struct.unpack_from('<I', data, 12)[0]
    document = json.loads(data[20:20+length])
    binary_start = 28 + length
    if any(any(k in node for k in ('matrix', 'translation', 'rotation', 'scale')) for node in document['nodes']):
        raise ValueError("unexpected source node transform")

    def accessor(index: int) -> list:
        a = document['accessors'][index]
        view = document['bufferViews'][a['bufferView']]
        if 'sparse' in a or 'byteStride' in view or view['buffer'] != 0:
            raise ValueError("unsupported pinned accessor layout")
        width = {'SCALAR': 1, 'VEC3': 3}[a['type']]
        code = {5125: 'I', 5126: 'f'}[a['componentType']]
        start = view.get('byteOffset', 0) + a.get('byteOffset', 0)
        if a.get('byteOffset', 0) + a['count'] * width * 4 > view['byteLength']:
            raise ValueError("accessor exceeds buffer view")
        values = struct.unpack_from(f"<{a['count']*width}{code}", data, binary_start+start)
        return list(values) if width == 1 else [list(values[i:i+width]) for i in range(0, len(values), width)]

    surfaces = {}
    for mesh in document['meshes']:
        match = re.fullmatch(r'(\d+)\.obj', mesh['name'])
        if not match or len(mesh['primitives']) != 1:
            raise ValueError("unexpected source mesh identity")
        identifier = int(match[1])
        if identifier in surfaces:
            raise ValueError("duplicate source identity")
        primitive = mesh['primitives'][0]
        if primitive.get('mode', 4) != 4:
            raise ValueError("source is not triangles")
        indices = accessor(primitive['indices'])
        if len(indices) % 3:
            raise ValueError("incomplete triangle")
        surfaces[identifier] = (accessor(primitive['attributes']['POSITION']), [indices[i:i+3] for i in range(0, len(indices), 3)])
    return surfaces


def audit(glb: Path, baseline: Path, tolerances: list[float]) -> dict:
    manifest_bytes = (baseline / 'manifest.json').read_bytes()
    if hashlib.sha256(manifest_bytes).hexdigest() != MANIFEST_SHA:
        raise ValueError("D042 baseline manifest SHA mismatch")
    manifest = validate_pack(baseline)
    surfaces = read_pinned_glb(glb.read_bytes())
    selected = sorted({r['source_allen_id'] for r in manifest['regions']})
    matrix = manifest['coordinate_system']['source_to_world_um']
    rows = []
    for identifier in selected:
        positions, triangles = surfaces[identifier]
        world = [[sum(matrix[axis*4+i]*p[i] for i in range(3)) + matrix[axis*4+3] for axis in range(3)] for p in positions]
        variants = []
        for connectivity in ('edge', 'vertex'):
            for tolerance in tolerances:
                variants.append({'connectivity': connectivity, 'tolerance_um': tolerance,
                                 **audit_surface(world, triangles, connectivity=connectivity, tolerance_um=tolerance)})
        rows.append({'source_allen_id': identifier, 'variants': variants})
    return {'format': 'native-mesh-component-audit-v1', 'purpose': 'review-only',
            'source_sha256': SOURCE_SHA, 'baseline_manifest_sha256': MANIFEST_SHA,
            'source_to_world_um': matrix, 'selected_source_count': len(selected),
            'source_triangle_count': sum(r['variants'][0]['triangle_count'] for r in rows),
            'surfaces': rows}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--glb', type=Path, required=True)
    parser.add_argument('--baseline', type=Path, required=True)
    parser.add_argument('--tolerance-um', type=float, nargs='+', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    report = audit(args.glb, args.baseline, args.tolerance_um)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open('x') as stream:
        stream.write(json.dumps(report, sort_keys=True, separators=(',', ':'), allow_nan=False)+'\n')


if __name__ == '__main__':
    main()
