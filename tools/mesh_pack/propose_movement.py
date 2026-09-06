"""Create review-only movement suggestions from a hash-verified component audit.

The extent threshold prioritizes review; it is not an anatomical classifier or
an accepted release selection. No runtime code consumes these suggestions.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from collections import Counter
from pathlib import Path


def propose(audit: dict, *, tolerance_um: float, dominant_extent_fraction: float) -> dict:
    if not math.isfinite(tolerance_um) or tolerance_um < 0:
        raise ValueError('tolerance must be finite and nonnegative')
    if not math.isfinite(dominant_extent_fraction) or not 0.5 < dominant_extent_fraction <= 1:
        raise ValueError('dominant extent fraction must be in (0.5, 1]')
    if audit.get('format') != 'native-mesh-component-audit-v1' or audit.get('purpose') != 'review-only':
        raise ValueError('expected a review-only native component audit')
    rows = []
    keys = set()
    for surface in audit['surfaces']:
        variants = [v for v in surface['variants'] if v['connectivity'] == 'edge' and v['tolerance_um'] == tolerance_um]
        if len(variants) != 1:
            raise ValueError('expected exactly one matching edge-connectivity variant')
        for component in variants[0]['components']:
            key = (surface['source_allen_id'], component['first_triangle'])
            if key in keys:
                raise ValueError('duplicate component identity')
            keys.add(key)
            low, high = component['ml_bounds_um']
            if not all(math.isfinite(x) for x in (low, high)) or low > high:
                raise ValueError('invalid component bounds')
            left, right = max(0, -low), max(0, high)
            fraction = max(left, right) / (left + right) if left + right else None
            classification = component['classification']
            expected = ('left' if high < -tolerance_um else 'right' if low > tolerance_um
                        else 'neutral' if low < -tolerance_um and high > tolerance_um else 'ambiguous')
            if classification != expected:
                raise ValueError('classification differs from component bounds')
            if classification in ('left', 'right'):
                movement, reason = classification, 'strict-half-space'
            elif classification == 'ambiguous':
                movement, reason = None, 'ambiguous-bounds'
            elif fraction is not None and fraction >= dominant_extent_fraction:
                movement, reason = ('left' if left > right else 'right'), 'dominant-extent-review'
            else:
                movement, reason = 'fixed', 'spanning-review'
            rows.append({'source_allen_id': key[0], 'first_triangle': key[1],
                         'triangle_count': component['triangle_count'], 'ml_bounds_um': [low, high],
                         'geometric_classification': classification,
                         'dominant_extent_fraction': fraction,
                         'proposed_movement': movement, 'reason': reason,
                         'review_status': 'unreviewed'})
    return {'format': 'native-mesh-movement-proposal-v1', 'purpose': 'review-only',
            'source_sha256': audit['source_sha256'],
            'baseline_manifest_sha256': audit['baseline_manifest_sha256'],
            'parameters': {'connectivity': 'edge', 'tolerance_um': tolerance_um,
                           'dominant_extent_fraction': dominant_extent_fraction,
                           'metric': 'maximum distance from ML=0 divided by summed left/right distances'},
            'summary': dict(sorted(Counter(r['proposed_movement'] or 'unresolved' for r in rows).items())),
            'components': sorted(rows, key=lambda r: (r['source_allen_id'], r['first_triangle']))}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--audit', type=Path, required=True)
    parser.add_argument('--audit-sha256', required=True)
    parser.add_argument('--tolerance-um', type=float, required=True)
    parser.add_argument('--dominant-extent-fraction', type=float, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    data = args.audit.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    if digest != args.audit_sha256:
        raise ValueError('audit SHA-256 mismatch')
    result = propose(json.loads(data), tolerance_um=args.tolerance_um,
                     dominant_extent_fraction=args.dominant_extent_fraction)
    result['audit_sha256'] = digest
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open('x') as stream:
        stream.write(json.dumps(result, sort_keys=True, separators=(',', ':'), allow_nan=False)+'\n')


if __name__ == '__main__':
    main()
