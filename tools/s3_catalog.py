"""Validate a curator catalog offline, or explicitly promote it to S3."""
from __future__ import annotations

import argparse
from contextlib import ExitStack
import json
from pathlib import Path
import subprocess

from ephys_atlas_builder.schema_v1 import validate_schema_v1_document
from tools.s3_publish import REPOSITORY, validated_snapshot
from ibl_ephys_atlas_publish.core import PublishingError
from ibl_ephys_atlas_publish.s3 import AwsCliStore, Destination, release_plan
from ibl_ephys_atlas_publish.s3_catalog import compile_catalog, promote_catalog


def validate_catalog(catalog):
    validate_schema_v1_document(catalog, "catalog.schema.json")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("config", type=Path)
    parser.add_argument("--release", type=Path, action="append", required=True)
    parser.add_argument("--environment", choices=("staging", "production"), required=True)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--profile")
    parser.add_argument("--confirm-root")
    args = parser.parse_args(argv)
    destination = Destination(args.environment)
    if args.apply and (not args.profile or args.confirm_root != destination.root):
        parser.error("--apply requires --profile and exact --confirm-root")
    try:
        config_path = args.config.resolve()
        relative = config_path.relative_to(REPOSITORY)
        subprocess.run(["git", "ls-files", "--error-unmatch", "--", str(relative)],
                       cwd=REPOSITORY, check=True, capture_output=True)
        config = json.loads(config_path.read_bytes())
        with ExitStack() as stack:
            releases = []
            for source in args.release:
                root, files = stack.enter_context(validated_snapshot(source.absolute()))
                releases.append((root, release_plan(root, destination, files, [])))
            preview, _ = compile_catalog(config, releases)
            validate_catalog(preview)
            if args.apply:
                result = promote_catalog(config, releases, destination,
                                         AwsCliStore(destination, args.profile), validate_catalog)
            else:
                result = {"mode": "offline-validation", "remote_history_checked": False, "catalog": preview}
            print(json.dumps(result, indent=2))
    except (PublishingError, RuntimeError, ValueError, OSError, subprocess.CalledProcessError) as error:
        parser.exit(1, f"catalog promotion failed: {error}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
