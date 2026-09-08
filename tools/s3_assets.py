"""Validate and plan packs/site builds offline; --apply explicitly publishes."""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import json
from pathlib import Path
import platform
import shutil
import tempfile

from ephys_atlas_builder.build_environment import build_environment
from tools.release_preflight import repository_state
from tools.s3_publish import REPOSITORY, publication_store
from tools.mesh_pack.validate import validate_pack
from tools.projection_pack.build import validate_projection_pack
from ibl_ephys_atlas_publish.core import PublishingError
from ibl_ephys_atlas_publish.s3 import Destination
from ibl_ephys_atlas_publish.s3_assets import asset_plan, publish_assets


def canonical_host():
    repo = repository_state(REPOSITORY)
    if platform.system() != "Linux" or repo.branch != "main" or not repo.clean:
        raise ValueError("publication requires Linux and clean main")
    return repo


@contextmanager
def snapshot(source: Path):
    if source.is_symlink() or any(p.is_symlink() for p in source.rglob("*")):
        raise ValueError("asset symlinks are forbidden")
    with tempfile.TemporaryDirectory(prefix="atlas-asset-snapshot-") as temporary:
        root = Path(temporary) / source.name
        shutil.copytree(source, root, symlinks=True)
        if any(p.is_symlink() for p in root.rglob("*")):
            raise ValueError("asset changed to contain symlinks")
        yield root


def validate_asset(root: Path, kind: str) -> tuple[str, list[str], list[dict]]:
    repo = canonical_host()
    dependencies = []
    if kind == "projection":
        document = validate_projection_pack(root)
        builder = document["provenance"]["builder"]
        if (builder.get("environment") != build_environment() or builder.get("commit") != repo.commit
                or document["provenance"]["recipe"].get("static_source_mode") != "pinned-curated"):
            raise ValueError("projection pack requires exact current Linux build provenance")
        identity = document["pack_id"]
    elif kind == "mesh":
        document = validate_pack(root)
        report = json.loads((root / document["validation"]["report"]["path"]).read_bytes())
        expected = {"system": platform.system(), "machine": platform.machine(), "python": platform.python_version()}
        if (document["purpose"] != "production" or document["builder"]["commit"] != repo.commit
                or report.get("evidence", {}).get("environment") != expected):
            raise ValueError("mesh pack requires approved purpose and exact current Linux build provenance")
        identity = document["pack_id"]
    elif kind == "site":
        from tools.site_build import validate_site
        document = validate_site(root, repo)
        identity = document["build_id"]
        dependencies = document["dependencies"]
    else:
        raise ValueError("unknown asset kind")
    files = sorted(p.relative_to(root).as_posix() for p in root.rglob("*") if p.is_file())
    return identity, files, dependencies


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("kind", choices=("projection", "mesh", "site"))
    parser.add_argument("directory", type=Path)
    parser.add_argument("--environment", choices=("staging", "production"), required=True)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--profile")
    parser.add_argument("--transport", choices=("cli", "sdk"), default="cli")
    parser.add_argument("--confirm-root")
    args = parser.parse_args(argv)
    destination = Destination(args.environment)
    if args.apply and (not args.profile or args.confirm_root != destination.root):
        parser.error("--apply requires --profile and exact --confirm-root")
    try:
        with snapshot(args.directory.absolute()) as root:
            identity, files, dependencies = validate_asset(root, args.kind)
            plan = asset_plan(root, destination, args.kind, identity, files, dependencies)
            if args.apply:
                store = publication_store(destination, args.profile, args.transport)
                try:
                    result = publish_assets(root, destination, plan, store)
                finally:
                    close = getattr(store, "close", None)
                    if close is not None:
                        close()
            else:
                result = {"mode": "offline-plan", **plan}
            print(json.dumps(result, indent=2))
    except (PublishingError, ValueError, RuntimeError, OSError) as error:
        parser.exit(1, f"asset publication failed: {error}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
