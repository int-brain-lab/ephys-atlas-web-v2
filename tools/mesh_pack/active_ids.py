"""Derive the 3-D active Allen inventory from a validated projection pack."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import re
from pathlib import Path

from tools.svg_pack.codec import decode

_ALLEN_ID = re.compile(r'data-allen-id="(-?\d+)"')
_REQUIRED_CANONICAL_IDS = {545}


def build_active_ids(pack_root: Path, output: Path) -> dict:
    manifest_path = pack_root / "manifest.json"
    manifest_bytes = manifest_path.read_bytes()
    manifest = json.loads(manifest_bytes)
    ids: set[int] = set()
    resources: list[str] = []
    for path in sorted(pack_root.glob("packs/**/*.isvg.gz")):
        resources.append(path.relative_to(pack_root).as_posix())
        pack = decode(gzip.decompress(path.read_bytes()))
        for fragment in pack.fragments:
            ids.update(abs(int(value)) for value in _ALLEN_ID.findall(fragment.svg))
    sampled_ids = set(ids)
    ids.update(_REQUIRED_CANONICAL_IDS)
    document = {
        "format": "atlas-mesh-active-ids-v1",
        "projection_pack_id": manifest["pack_id"],
        "projection_manifest_sha256": hashlib.sha256(manifest_bytes).hexdigest(),
        "sampled_resource_count": len(resources),
        "sampled_allen_id_count": len(sampled_ids),
        "canonical_additions": sorted(_REQUIRED_CANONICAL_IDS - sampled_ids),
        "allen_ids": sorted(ids),
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(document, indent=2, sort_keys=True) + "\n")
    return document


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--projection-pack", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    arguments = parser.parse_args()
    build_active_ids(arguments.projection_pack, arguments.output)


if __name__ == "__main__":
    main()
