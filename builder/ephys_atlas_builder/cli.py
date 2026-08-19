from __future__ import annotations

import argparse
from pathlib import Path

from .fixture import generate_golden
from .package import package_release
from .sources import pull, resolve_source_release
from .validate import ValidationError, validate_release


def _schema_dir() -> Path:
    return Path(__file__).resolve().parents[2] / "schema" / "v0.1"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="ephys-atlas-data")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("validate", help="validate an already-built immutable release")
    p.add_argument("release_dir", type=Path)
    p.add_argument("--schema-dir", type=Path, default=_schema_dir())

    p = sub.add_parser("golden", help="generate the deterministic golden fixture")
    p.add_argument("output_dir", type=Path)
    p.add_argument("--schema-dir", type=Path, default=_schema_dir())

    p = sub.add_parser("pull", help="download canonical scientific source artifacts")
    p.add_argument("dataset")
    p.add_argument("release")
    p.add_argument("--dest", type=Path, default=Path("data/source"))

    p = sub.add_parser("build", help="validate a release produced by a dataset-specific build recipe")
    p.add_argument("dataset")
    p.add_argument("release")
    p.add_argument("--source-root", type=Path, default=Path("data/source"))
    p.add_argument("--release-root", type=Path, default=Path("data/releases"))
    p.add_argument("--schema-dir", type=Path, default=_schema_dir())

    p = sub.add_parser("package", help="create a deterministic whole-release ZIP")
    p.add_argument("release_dir", type=Path)
    p.add_argument("output", type=Path)

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
            path = pull(args.dataset, args.release, args.dest)
            print(path)
        elif args.cmd == "build":
            resolved = resolve_source_release(args.source_root, args.dataset, args.release)
            source = args.source_root / args.dataset / resolved / "source.json"
            release_dir = args.release_root / args.dataset / resolved
            if not source.is_file():
                raise RuntimeError(f"missing source snapshot: {source}; run data-pull first")
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
    except (ValidationError, RuntimeError, ValueError) as e:
        parser.error(str(e))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
