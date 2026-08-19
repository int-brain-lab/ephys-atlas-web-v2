from __future__ import annotations

import argparse
from pathlib import Path

from .fixture import generate_golden
from .sources import pull
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
    p.add_argument("release_dir", type=Path)
    p.add_argument("--schema-dir", type=Path, default=_schema_dir())

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
            # Build recipes are intentionally dataset-specific because source scientific
            # semantics are not interchangeable. v0.1 provides the common writer and
            # validator primitives; recipe-specific transforms are added only after their
            # semantics are approved and pinned.
            validate_release(args.release_dir, args.schema_dir)
            print(f"validated built release: {args.release_dir}")
    except (ValidationError, RuntimeError, ValueError) as e:
        parser.error(str(e))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
