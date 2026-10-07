"""Validate a curator catalog offline, or explicitly promote it to S3."""
from __future__ import annotations

import argparse
from contextlib import ExitStack, contextmanager
import json
import platform
from pathlib import Path
import shutil
import tempfile
import subprocess

from ephys_atlas_builder.development_bundle import _validate_release_directory
from ephys_atlas_builder.schema_v1 import validate_schema_v1_document
from tools.s3_publish import REPOSITORY, publication_store
from tools.release_preflight import check_catalog_release, repository_state
from tools.site_compatibility import check_compatibility, validate_catalog_links
from ibl_ephys_atlas_publish.core import PublishingError
from ibl_ephys_atlas_publish.s3 import Destination, release_plan
from ibl_ephys_atlas_publish.s3_catalog import compile_catalog, promote_catalog


@contextmanager
def validated_catalog_snapshot(source: Path):
    """Hold an immutable local graph for catalog compilation, not publication."""
    if source.is_symlink() or any(path.is_symlink() for path in source.rglob("*")):
        raise ValueError("release symlinks are not allowed")
    with tempfile.TemporaryDirectory(prefix="atlas-catalog-release-") as temporary:
        snapshot = Path(temporary) / source.name
        shutil.copytree(source, snapshot, symlinks=True)
        if any(path.is_symlink() for path in snapshot.rglob("*")):
            raise ValueError("release changed to contain symlinks during snapshot")
        check_catalog_release(
            snapshot, repo=repository_state(REPOSITORY), host_os=platform.system()
        )
        files = _validate_release_directory(
            snapshot, json.loads((snapshot / "manifest.json").read_bytes())
        )
        yield snapshot, files


def validate_catalog(catalog):
    validate_schema_v1_document(catalog, "catalog.schema.json")


def verify_catalog_site(catalog: dict, site_config: Path, origin: str) -> None:
    """Exercise proposed discovery against the running browser before any write."""
    from tools.site_build import dependencies
    config = json.loads(site_config.read_bytes())
    dependencies(config)
    check_compatibility(config, origin=origin)
    validate_catalog_links(catalog)
    with tempfile.TemporaryDirectory(prefix="atlas-catalog-browser-") as temporary:
        candidate = Path(temporary) / "catalog.json"
        candidate.write_text(json.dumps(catalog))
        try:
            subprocess.run(["node", "web/scripts/verify-production-site.mjs", origin, "", str(candidate), str(site_config.resolve())],
                           cwd=REPOSITORY, check=True, capture_output=True, text=True)
        except subprocess.CalledProcessError as error:
            raise ValueError(f"proposed catalog failed running-site verification: {error.stderr or error}") from error


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("config", type=Path)
    parser.add_argument("--release", type=Path, action="append", required=True)
    parser.add_argument("--environment", choices=("staging", "production"), required=True)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--profile")
    parser.add_argument("--transport", choices=("cli", "sdk"), default="cli")
    parser.add_argument("--confirm-root")
    parser.add_argument("--site-config", type=Path, default=REPOSITORY / "data/deployment/initial-site.json")
    parser.add_argument("--site-origin", default="https://ephys-atlas.iblcore.org")
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
                root, files = stack.enter_context(validated_catalog_snapshot(source.absolute()))
                releases.append((root, release_plan(root, destination, files, [])))
            preview, _ = compile_catalog(config, releases)
            validate_catalog(preview)
            if args.apply:
                if args.environment == "production":
                    verify_catalog_site(preview, args.site_config, args.site_origin)
                store = publication_store(destination, args.profile, args.transport)
                try:
                    result = promote_catalog(
                        config, releases, destination, store, validate_catalog
                    )
                finally:
                    close = getattr(store, "close", None)
                    if callable(close):
                        close()
            else:
                result = {
                    "mode": "offline-validation",
                    "remote_history_checked": False,
                    "catalog": preview,
                }
            print(json.dumps(result, indent=2))
    except (PublishingError, RuntimeError, ValueError, OSError, subprocess.CalledProcessError) as error:
        parser.exit(1, f"catalog promotion failed: {error}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
