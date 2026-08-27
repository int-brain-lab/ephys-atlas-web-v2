"""Build a local-review-only pack with pinned Top and synthetic Swanson geometry."""
from __future__ import annotations

import argparse
import json
import subprocess
import tempfile
from pathlib import Path

from tools.projection_pack.build import PINNED_STATIC_SOURCES, build_projection_pack


def _write_synthetic_swanson(path: Path) -> None:
    fragment = (
        '<path class="allen_region_1 beryl_region_1 cosmos_region_1" '
        'd="M60 20L61 20L61 21Z"/>'
    ) * PINNED_STATIC_SOURCES["swanson"].path_count
    path.write_text(json.dumps({"0": fragment}, separators=(",", ":")))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--registered-parent", type=Path, required=True)
    parser.add_argument("--regions", type=Path, required=True)
    parser.add_argument("--top", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--created-at", required=True)
    args = parser.parse_args()
    repository = Path(__file__).resolve().parents[2]
    commit = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=repository, check=True, capture_output=True, text=True
    ).stdout.strip()
    dirty = subprocess.run(
        ["git", "status", "--porcelain", "--untracked-files=no"],
        cwd=repository,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    if dirty:
        raise RuntimeError("refusing provenance build from a dirty tracked worktree")
    with tempfile.TemporaryDirectory(prefix="projection-pack-top-review-") as temporary:
        swanson = Path(temporary) / "swanson.json"
        _write_synthetic_swanson(swanson)
        build_projection_pack(
            args.registered_parent,
            args.regions,
            {"top": args.top, "swanson": swanson},
            args.output,
            created_at=args.created_at,
            generator_commit=commit,
            static_mode="pinned-top-review",
        )


if __name__ == "__main__":
    main()
