"""Validate the pinned local development bundle without network access."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import sys

from ephys_atlas_builder.development_bundle import (
    ValidatedDevelopmentBundle,
    validate_development_bundle,
)


def _report(bundle: ValidatedDevelopmentBundle) -> None:
    print(
        f"validated available corpus {bundle.bundle_id}: {len(bundle.artifacts)} artifacts, "
        f"{sum(item.file_count for item in bundle.artifacts)} files, "
        f"{bundle.stored_bytes} bytes"
    )
    for item in bundle.unavailable:
        requirement = "required for the complete bundle" if item["required_for_complete_bundle"] else "optional"
        print(
            f"unavailable {item['role']} ({requirement}): {item['reason']}",
            file=sys.stderr,
        )


def _environment(bundle: ValidatedDevelopmentBundle) -> dict[str, str]:
    releases = [artifact for artifact in bundle.artifacts if artifact.kind == "release"]
    default = bundle.default_view
    primary = next(
        artifact for artifact in releases
        if artifact.identity == {
            "dataset_id": default["dataset_id"],
            "release_id": default["release_id"],
        }
    )
    additional = [artifact for artifact in releases if artifact is not primary]
    environment = dict(os.environ)
    for key in list(environment):
        if key.startswith("EPHYS_ATLAS_") or key in {
            "VITE_BRAIN_MESH_MANIFEST_URL",
            "VITE_BRAIN_MESH_MANIFEST_BYTES",
            "VITE_BRAIN_MESH_MANIFEST_SHA256",
            "VITE_DATASET_CATALOG_URL",
            "VITE_PROJECTION_PACK_URL",
            "VITE_DEFAULT_DATASET_ID",
            "VITE_DEFAULT_RELEASE_ID",
            "VITE_DEFAULT_FEATURE_ID",
            "VITE_DEFAULT_PARCELLATION_ID",
        }:
            environment.pop(key)
    environment.update({
        "EPHYS_ATLAS_REAL_RELEASE": str(primary.root),
        "EPHYS_ATLAS_ADDITIONAL_RELEASES": ",".join(str(item.root) for item in additional),
        "EPHYS_ATLAS_REAL_FEATURE": default["feature_id"],
        "EPHYS_ATLAS_REAL_PARCELLATION": default["parcellation_id"],
        "EPHYS_ATLAS_EXPECTED_RELEASES": ",".join(
            f"{item.identity['dataset_id']}={item.identity['release_id']}" for item in releases
        ),
    })
    projection = next(
        (artifact for artifact in bundle.artifacts if artifact.kind == "projection_pack"),
        None,
    )
    mesh = next(
        (artifact for artifact in bundle.artifacts if artifact.kind == "mesh_pack"),
        None,
    )
    if projection is not None:
        environment["EPHYS_ATLAS_PROJECTION_PACK"] = str(projection.root)
    if mesh is not None:
        environment["EPHYS_ATLAS_REAL_MESH_PACK"] = str(mesh.root)
    else:
        environment.pop("EPHYS_ATLAS_REAL_MESH_PACK", None)
    environment["EPHYS_ATLAS_EXPECTED_MESH"] = "1" if mesh is not None else "0"
    return environment


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    validate = commands.add_parser("validate", help="verify the complete available local graph")
    validate.add_argument("descriptor", type=Path)
    run = commands.add_parser("run", help="verify the bundle and run a descriptor-configured command")
    run.add_argument("descriptor", type=Path)
    run.add_argument("--cwd", type=Path, default=Path.cwd())
    run.add_argument("child", nargs=argparse.REMAINDER)
    arguments = parser.parse_args()
    bundle = validate_development_bundle(arguments.descriptor)
    _report(bundle)
    if arguments.command == "run":
        child = arguments.child[1:] if arguments.child[:1] == ["--"] else arguments.child
        if not child:
            parser.error("run requires a command after --")
        os.chdir(arguments.cwd.resolve())
        os.execvpe(child[0], child, _environment(bundle))


if __name__ == "__main__":
    main()
