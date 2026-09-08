"""Plan (default) or explicitly apply an S3 dataset-release publication."""
from __future__ import annotations

import argparse
import json
import platform
import shutil
import sys
import tempfile
from contextlib import contextmanager
from pathlib import Path

from ephys_atlas_builder.development_bundle import _validate_release_directory

from tools.release_preflight import (
    check_release,
    check_staging_benchmark_release,
    repository_state,
)

REPOSITORY = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPOSITORY / "publishing" / "src"))
from ibl_ephys_atlas_publish.core import PublishingError
from ibl_ephys_atlas_publish.s3 import (
    AwsCliStore,
    Destination,
    publish_direct_benchmark,
    publish_release,
    publish_staging_benchmark,
    release_plan,
)


def publication_store(destination: Destination, profile: str, transport: str):
    """Construct the selected credential-bound store only for an apply operation."""
    if transport == "cli":
        return AwsCliStore(destination, profile)
    if transport == "sdk":
        from ibl_ephys_atlas_publish.s3_sdk import AwsSdkStore
        return AwsSdkStore(destination, profile)
    raise ValueError(f"unsupported publication transport: {transport}")


@contextmanager
def validated_snapshot(source: Path, *, staging_benchmark: bool = False):
    """Validate exactly the private snapshot that will be transmitted."""
    if source.is_symlink() or any(path.is_symlink() for path in source.rglob("*")):
        raise ValueError("release symlinks are not allowed")
    with tempfile.TemporaryDirectory(prefix="atlas-publication-") as temporary:
        snapshot = Path(temporary) / source.name
        shutil.copytree(source, snapshot, symlinks=True)
        if any(path.is_symlink() for path in snapshot.rglob("*")):
            raise ValueError("release changed to contain symlinks during snapshot")
        repo = repository_state(REPOSITORY)
        checker = check_staging_benchmark_release if staging_benchmark else check_release
        checker(snapshot, repo=repo, host_os=platform.system())
        files = _validate_release_directory(snapshot, json.loads((snapshot / "manifest.json").read_bytes()))
        yield snapshot, files


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("release", type=Path)
    parser.add_argument("--environment", required=True, choices=("staging", "production"))
    parser.add_argument("--alias", action="append", default=[])
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--staging-benchmark",
        action="store_true",
        help="publish a candidate for direct staging-origin measurement without an index/catalog entry",
    )
    mode.add_argument(
        "--direct-benchmark",
        action="store_true",
        help="publish the Q5 volume candidate at the existing production origin without an index/catalog entry",
    )
    parser.add_argument("--apply", action="store_true", help="perform remote writes; otherwise entirely offline")
    parser.add_argument("--profile", help="explicit temporary-credential AWS profile (apply only)")
    parser.add_argument(
        "--transport", choices=("cli", "sdk"), default="cli",
        help="S3 client for --apply (default: CLI; SDK reuses a bounded connection pool)",
    )
    parser.add_argument("--confirm-root", help="apply requires the exact destination prefix printed by the plan")
    args = parser.parse_args(argv)
    destination = Destination(args.environment)
    if args.staging_benchmark and args.environment != "staging":
        parser.error("--staging-benchmark requires --environment staging")
    if args.direct_benchmark and args.environment != "production":
        parser.error("--direct-benchmark requires --environment production")
    if (args.staging_benchmark or args.direct_benchmark) and args.alias:
        parser.error("benchmark publication does not permit aliases")
    if args.apply and (not args.profile or args.confirm_root != destination.root):
        parser.error("--apply requires --profile and --confirm-root matching the exact deployment prefix")
    try:
        benchmark = args.staging_benchmark or args.direct_benchmark
        with validated_snapshot(args.release.absolute(), staging_benchmark=benchmark) as (snapshot, files):
            plan = release_plan(snapshot, destination, files, args.alias)
            if args.direct_benchmark and plan["dataset_id"] != "ephys_atlas_volumes":
                raise ValueError("direct benchmark is restricted to ephys_atlas_volumes")
            if args.apply:
                publisher = (
                    publish_staging_benchmark if args.staging_benchmark
                    else publish_direct_benchmark if args.direct_benchmark
                    else publish_release
                )
                store = publication_store(destination, args.profile, args.transport)
                try:
                    result = publisher(snapshot, destination, plan, store)
                finally:
                    close = getattr(store, "close", None)
                    if callable(close):
                        close()
            else:
                scope = (
                    "staging-benchmark" if args.staging_benchmark
                    else "direct-origin-benchmark" if args.direct_benchmark
                    else None
                )
                result = {
                    "mode": (
                        "offline-staging-benchmark-plan" if args.staging_benchmark
                        else "offline-direct-benchmark-plan" if args.direct_benchmark
                        else "offline-plan"
                    ),
                    **plan,
                    "total_bytes": sum(a["size"] for a in plan["artifacts"]),
                    **({"publication_scope": scope,
                        "dataset_index_changed": False, "catalog_changed": False}
                       if scope else {}),
                }
            print(json.dumps(result, indent=2))
    except (PublishingError, RuntimeError, ValueError, OSError) as error:
        parser.exit(1, f"S3 publication failed: {error}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
