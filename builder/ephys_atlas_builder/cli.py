from __future__ import annotations

import argparse
from pathlib import Path

from .channels import DATASET_ID as CHANNELS_DATASET_ID
from .channels import ChannelBuildConfig, build_channels_from_snapshot
from .clusters import DATASET_ID as CLUSTERS_DATASET_ID
from .clusters import ClusterBuildConfig, build_clusters_from_snapshot
from .fixture import generate_golden
from .npz import inspect_volume_npz
from .package import package_release
from .sources import pull, resolve_source_release
from .validate import ValidationError, validate_release


def _schema_dir() -> Path:
    return Path(__file__).resolve().parents[2] / "schema" / "v1"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="ephys-atlas-data")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("validate", help="validate an already-built immutable release")
    p.add_argument("release_dir", type=Path)
    p.add_argument("--schema-dir", type=Path, default=_schema_dir())

    p = sub.add_parser(
        "build-clusters",
        help="build regional ephys_atlas_clusters from a pulled content-addressed project snapshot",
    )
    p.add_argument(
        "release", help="immutable content-derived release or pulled latest alias"
    )
    p.add_argument(
        "--project", required=True, help="exact source project/cohort identifier"
    )
    p.add_argument("--population", required=True, choices=("all",))
    p.add_argument(
        "--created-at",
        required=True,
        help="ISO-8601 release timestamp recorded verbatim in provenance",
    )
    p.add_argument(
        "--feature",
        action="append",
        dest="features",
        required=True,
        help="explicit scalar cluster feature; repeat to define the complete release catalog",
    )
    p.add_argument(
        "--log-color-feature",
        action="append",
        dest="log_color_features",
        help="feature id whose presentation-only default color scale is logarithmic; repeat as needed",
    )
    p.add_argument(
        "--parcellation",
        action="append",
        choices=("allen", "beryl", "cosmos"),
        dest="parcellations",
    )
    p.add_argument("--histogram-bins", type=int, default=50)
    p.add_argument("--paper-snapshot", action="store_true")
    p.add_argument(
        "--ibleatools-commit",
        required=True,
        help="pinned int-brain-lab/ibleatools commit",
    )
    p.add_argument(
        "--iblatlas-commit", required=True, help="pinned int-brain-lab/iblatlas commit"
    )
    p.add_argument(
        "--builder-commit", required=True, help="pinned builder repository commit"
    )
    p.add_argument("--source-root", type=Path, default=Path("data/source"))
    p.add_argument("--release-root", type=Path, default=Path("data/releases"))
    p.add_argument("--schema-dir", type=Path, default=_schema_dir())

    p = sub.add_parser("golden", help="generate the deterministic golden fixture")
    p.add_argument("output_dir", type=Path)
    p.add_argument("--schema-dir", type=Path, default=_schema_dir())

    p = sub.add_parser("pull", help="download canonical scientific source artifacts")
    p.add_argument("dataset")
    p.add_argument("release")
    p.add_argument("--dest", type=Path, default=Path("data/source"))
    p.add_argument(
        "--project",
        help="required explicit project for ephys_atlas_clusters; other datasets use canonical projects",
    )

    p = sub.add_parser(
        "build-channels",
        help="build a regional ephys_atlas_channels release from an already-pulled ea_active snapshot",
    )
    p.add_argument(
        "release",
        help="immutable source vintage or latest alias already pulled locally",
    )
    p.add_argument("--feature-mode", required=True, choices=("raw", "denoised", "both"))
    p.add_argument("--population", required=True, choices=("all", "inside"))
    p.add_argument(
        "--created-at",
        required=True,
        help="ISO-8601 release timestamp recorded verbatim in provenance",
    )
    p.add_argument(
        "--feature",
        action="append",
        dest="features",
        help="explicit feature id; repeat as needed; omit to resolve current voltage_features_set()",
    )
    p.add_argument(
        "--log-color-feature",
        action="append",
        dest="log_color_features",
        help="output feature id whose presentation-only default color scale is logarithmic; repeat as needed",
    )
    p.add_argument(
        "--parcellation",
        action="append",
        choices=("allen", "beryl", "cosmos"),
        dest="parcellations",
    )
    p.add_argument("--histogram-bins", type=int, default=50)
    p.add_argument("--paper-snapshot", action="store_true")
    p.add_argument(
        "--ibleatools-commit",
        required=True,
        help="pinned int-brain-lab/ibleatools commit",
    )
    p.add_argument(
        "--iblatlas-commit", required=True, help="pinned int-brain-lab/iblatlas commit"
    )
    p.add_argument(
        "--builder-commit", required=True, help="pinned builder repository commit"
    )
    p.add_argument("--source-root", type=Path, default=Path("data/source"))
    p.add_argument("--release-root", type=Path, default=Path("data/releases"))
    p.add_argument("--schema-dir", type=Path, default=_schema_dir())

    p = sub.add_parser(
        "build", help="validate a release produced by a dataset-specific build recipe"
    )
    p.add_argument("dataset")
    p.add_argument("release")
    p.add_argument("--source-root", type=Path, default=Path("data/source"))
    p.add_argument("--release-root", type=Path, default=Path("data/releases"))
    p.add_argument("--schema-dir", type=Path, default=_schema_dir())

    p = sub.add_parser("package", help="create a deterministic whole-release ZIP")
    p.add_argument("release_dir", type=Path)
    p.add_argument("output", type=Path)

    p = sub.add_parser(
        "inspect-volume",
        help="report ZIP/NPY physical metadata without materializing volume arrays",
    )
    p.add_argument("npz", type=Path)

    args = parser.parse_args(argv)
    try:
        if args.cmd == "validate":
            validate_release(args.release_dir, args.schema_dir)
            print(f"valid: {args.release_dir}")
        elif args.cmd == "golden":
            release = generate_golden(args.output_dir)
            validate_release(release, args.schema_dir)
            print(f"generated and validated: {release}")
        elif args.cmd == "pull":
            path = pull(args.dataset, args.release, args.dest, project=args.project)
            print(path)
        elif args.cmd == "build-channels":
            resolved = resolve_source_release(
                args.source_root, CHANNELS_DATASET_ID, args.release
            )
            source_snapshot = args.source_root / CHANNELS_DATASET_ID / resolved
            release_dir = args.release_root / CHANNELS_DATASET_ID / resolved
            config = ChannelBuildConfig(
                release_id=resolved,
                created_at=args.created_at,
                feature_mode=args.feature_mode,
                population=args.population,
                parcellations=tuple(args.parcellations or ("allen", "beryl", "cosmos")),
                features=tuple(args.features) if args.features else None,
                log_color_features=tuple(args.log_color_features or ()),
                histogram_bins=args.histogram_bins,
                paper_snapshot=args.paper_snapshot,
                ibleatools_commit=args.ibleatools_commit,
                iblatlas_commit=args.iblatlas_commit,
                builder_commit=args.builder_commit,
            )
            build_channels_from_snapshot(source_snapshot, release_dir, config)
            validate_release(release_dir, args.schema_dir)
            print(f"built and validated: {release_dir}")
        elif args.cmd == "build-clusters":
            resolved = resolve_source_release(
                args.source_root, CLUSTERS_DATASET_ID, args.release
            )
            source_snapshot = args.source_root / CLUSTERS_DATASET_ID / resolved
            release_dir = args.release_root / CLUSTERS_DATASET_ID / resolved
            config = ClusterBuildConfig(
                release_id=resolved,
                created_at=args.created_at,
                project=args.project,
                population=args.population,
                parcellations=tuple(args.parcellations or ("allen", "beryl", "cosmos")),
                features=tuple(args.features) if args.features else None,
                log_color_features=tuple(args.log_color_features or ()),
                histogram_bins=args.histogram_bins,
                paper_snapshot=args.paper_snapshot,
                ibleatools_commit=args.ibleatools_commit,
                iblatlas_commit=args.iblatlas_commit,
                builder_commit=args.builder_commit,
            )
            build_clusters_from_snapshot(source_snapshot, release_dir, config)
            validate_release(release_dir, args.schema_dir)
            print(f"built and validated: {release_dir}")
        elif args.cmd == "build":
            resolved = resolve_source_release(
                args.source_root, args.dataset, args.release
            )
            source = args.source_root / args.dataset / resolved / "source.json"
            release_dir = args.release_root / args.dataset / resolved
            if not source.is_file():
                raise RuntimeError(
                    f"missing source snapshot: {source}; run data-pull first"
                )
            if not (release_dir / "manifest.json").is_file():
                raise RuntimeError(
                    f"no approved dataset-specific recipe has produced {release_dir}; "
                    "scientific transforms are intentionally not guessed (see docs/data/HANDOFF.md)"
                )
            validate_release(release_dir, args.schema_dir)
            print(f"validated built release: {release_dir}")
        elif args.cmd == "package":
            info = package_release(args.release_dir, args.output)
            print(f"{info['sha256']}  {info['bytes']}  {info['path']}")
        elif args.cmd == "inspect-volume":
            import json

            print(json.dumps(inspect_volume_npz(args.npz), indent=2, sort_keys=True))
    except (ValidationError, RuntimeError, ValueError) as e:
        parser.error(str(e))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
