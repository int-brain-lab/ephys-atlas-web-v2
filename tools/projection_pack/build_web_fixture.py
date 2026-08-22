"""Build the test-only web projection pack with synthetic hidden static maps."""
from __future__ import annotations

import argparse
import json
import tempfile
from pathlib import Path

from tools.projection_pack.build import PINNED_STATIC_SOURCES, build_projection_pack


def _write_static_source(path: Path, count: int) -> None:
    fragment = (
        '<path class="allen_region_1 beryl_region_1 cosmos_region_1" '
        'd="M60 20L61 20L61 21Z"/>'
    ) * count
    path.write_text(json.dumps({"0": fragment}, separators=(",", ":")))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--registered-parent", type=Path, required=True)
    parser.add_argument("--regions", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--generator-commit", required=True)
    parser.add_argument("--created-at", required=True)
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="projection-pack-static-fixture-") as temporary:
        source_root = Path(temporary)
        sources = {name: source_root / f"{name}.json" for name in PINNED_STATIC_SOURCES}
        for name, source in sources.items():
            _write_static_source(source, PINNED_STATIC_SOURCES[name].path_count)
        build_projection_pack(
            args.registered_parent,
            args.regions,
            sources,
            args.output,
            created_at=args.created_at,
            generator_commit=args.generator_commit,
            static_mode="synthetic-fixture",
        )


if __name__ == "__main__":
    main()
