"""Plan (default) or explicitly apply an S3 dataset-release publication."""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import json
from pathlib import Path
import platform
import shutil
import sys
import tempfile

from ephys_atlas_builder.development_bundle import _validate_release_directory
from tools.release_preflight import check_release, repository_state

REPOSITORY = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPOSITORY / "publishing" / "src"))
from ibl_ephys_atlas_publish.s3 import (  # noqa: E402
    AwsCliStore, Destination, publish_release, release_plan,
)
from ibl_ephys_atlas_publish.core import PublishingError  # noqa: E402


@contextmanager
def validated_snapshot(source: Path):
    """Validate exactly the private snapshot that will be transmitted."""
    if source.is_symlink() or any(path.is_symlink() for path in source.rglob("*")):
        raise ValueError("release symlinks are not allowed")
    with tempfile.TemporaryDirectory(prefix="atlas-publication-") as temporary:
        snapshot = Path(temporary) / source.name
        shutil.copytree(source, snapshot, symlinks=True)
        if any(path.is_symlink() for path in snapshot.rglob("*")):
            raise ValueError("release changed to contain symlinks during snapshot")
        repo = repository_state(REPOSITORY)
        check_release(snapshot, repo=repo, host_os=platform.system())
        files = _validate_release_directory(snapshot, json.loads((snapshot / "manifest.json").read_bytes()))
        yield snapshot, files


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("release", type=Path)
    parser.add_argument("--environment", required=True, choices=("staging", "production"))
    parser.add_argument("--alias", action="append", default=[])
    parser.add_argument("--apply", action="store_true", help="perform remote writes; otherwise entirely offline")
    parser.add_argument("--profile", help="explicit temporary-credential AWS CLI profile (apply only)")
    parser.add_argument("--confirm-root", help="apply requires the exact destination prefix printed by the plan")
    args = parser.parse_args(argv)
    destination = Destination(args.environment)
    if args.apply and (not args.profile or args.confirm_root != destination.root):
        parser.error("--apply requires --profile and --confirm-root matching the exact deployment prefix")
    try:
        with validated_snapshot(args.release.absolute()) as (snapshot, files):
            plan = release_plan(snapshot, destination, files, args.alias)
            if args.apply:
                result = publish_release(snapshot, destination, plan, AwsCliStore(destination, args.profile))
            else:
                result = {"mode": "offline-plan", **plan, "total_bytes": sum(a["size"] for a in plan["artifacts"])}
            print(json.dumps(result, indent=2))
    except (PublishingError, RuntimeError, ValueError, OSError) as error:
        parser.exit(1, f"S3 publication failed: {error}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
