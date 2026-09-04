"""Refresh mutable source aliases and launch the reviewed local data bundle."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys

from ephys_atlas_builder.development_bundle import validate_development_bundle
from ephys_atlas_builder.sources import pull, resolve_source_release


DATASETS = (
    ("ephys_atlas_channels", {}),
    ("ephys_atlas_clusters", {"project": "ibl_neuropixel_brainwide_01"}),
)


def _canonical_release(manifest_path: Path) -> str:
    manifest = json.loads(manifest_path.read_text())
    releases = {
        source["release"]
        for source in manifest["provenance"]["sources"]
        if source["role"] == "canonical-data" and "release" in source
    }
    if len(releases) != 1:
        raise RuntimeError(f"expected one canonical source release in {manifest_path}")
    return releases.pop()


def check_latest_aliases(descriptor: Path, source_root: Path) -> None:
    """Refuse to apply old scientific selections to a newly appearing source."""
    document = json.loads(descriptor.read_text())
    releases = {
        artifact["identity"]["dataset_id"]: descriptor.parent.parent
        / artifact["destination"]
        for artifact in document["artifacts"]
        if artifact["kind"] == "release"
    }
    for dataset, _ in DATASETS:
        expected = _canonical_release(releases[dataset] / "manifest.json")
        latest = resolve_source_release(source_root, dataset, "latest")
        if latest != expected:
            raise RuntimeError(
                f"{dataset} latest is {latest}, but the reviewed local release uses {expected}; "
                "audit the new source and approve updated selections before rebuilding"
            )


def refresh(descriptor: Path, source_root: Path, *, download: bool = True) -> None:
    if download:
        for dataset, options in DATASETS:
            path = pull(dataset, "latest", source_root, **options)
            print(f"refreshed {dataset}: {path}")
    check_latest_aliases(descriptor, source_root)
    bundle = validate_development_bundle(descriptor)
    print(
        f"local data is current and validated: {bundle.bundle_id} "
        f"({len(bundle.artifacts)} artifacts, {bundle.stored_bytes} bytes)"
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--descriptor", type=Path, default=Path("data/development-bundle-v4.json")
    )
    parser.add_argument("--source-root", type=Path, default=Path("data/source"))
    parser.add_argument("--no-pull", action="store_true")
    parser.add_argument("--run", action="store_true", help="launch the viewer after refresh")
    arguments = parser.parse_args(argv)
    refresh(
        arguments.descriptor.resolve(),
        arguments.source_root.resolve(),
        download=not arguments.no_pull,
    )
    if arguments.run:
        os.execv(
            sys.executable,
            [
                sys.executable,
                "-m",
                "tools.development_bundle",
                "run",
                "--cwd",
                "web",
                str(arguments.descriptor.resolve()),
                "--",
                "npm",
                "run",
                "dev:real",
            ],
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
