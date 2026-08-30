"""Command-line entry point for opt-in local-import benchmark corpora."""

from __future__ import annotations

import argparse
from pathlib import Path
import re

from .corpus import (
    CapacityCase,
    ReleaseCase,
    generate_adversarial_corpus,
    generate_capacity_corpus,
    generate_real_corpus,
)


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_GOLDEN = ROOT / "fixtures" / "golden-v1"
DEFAULT_SCHEMA = ROOT / "schema" / "v1"
DEFAULT_OUTPUT = ROOT / "artifacts" / "local-import-benchmark"
_SIZE = re.compile(r"^(\d+)([KMG]iB|B)?$", re.IGNORECASE)


def _bytes(value: str) -> int:
    match = _SIZE.fullmatch(value)
    if not match:
        raise argparse.ArgumentTypeError("size must be an integer followed by B, KiB, MiB, or GiB")
    amount = int(match.group(1))
    unit = (match.group(2) or "B").lower()
    return amount * {"b": 1, "kib": 1024, "mib": 1024**2, "gib": 1024**3}[unit]


def _release(value: str) -> ReleaseCase:
    try:
        case_id, representation, raw_path = value.split("=", 2)
    except ValueError as error:
        raise argparse.ArgumentTypeError("release must be ID=regional|volume=PATH") from error
    return ReleaseCase(case_id, representation, Path(raw_path))


def _capacity(value: str) -> CapacityCase:
    try:
        case_id, raw_bytes, raw_entries = value.split("=", 2)
        return CapacityCase(case_id, _bytes(raw_bytes), int(raw_entries))
    except (ValueError, argparse.ArgumentTypeError) as error:
        raise argparse.ArgumentTypeError("case must be ID=PAYLOAD_BYTES=ENTRIES") from error


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(
        description="Generate ignored local-import benchmark ZIP corpora.",
    )
    commands = result.add_subparsers(dest="command", required=True)

    real = commands.add_parser("real", help="bundle unchanged schema-v1 release directories")
    real.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT / "real")
    real.add_argument("--release", type=_release, action="append", required=True)
    real.add_argument("--schema-dir", type=Path, default=DEFAULT_SCHEMA)

    adversarial = commands.add_parser("adversarial", help="write compact invalid ZIP cases")
    adversarial.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT / "adversarial")

    capacity = commands.add_parser("capacity", help="write valid synthetic size/count cases")
    capacity.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT / "capacity")
    capacity.add_argument("--case", type=_capacity, action="append", required=True)
    capacity.add_argument("--golden-release", type=Path, default=DEFAULT_GOLDEN)
    capacity.add_argument("--schema-dir", type=Path, default=DEFAULT_SCHEMA)
    return result


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    if args.command == "real":
        index = generate_real_corpus(args.output_dir, args.release, schema_dir=args.schema_dir)
    elif args.command == "adversarial":
        index = generate_adversarial_corpus(args.output_dir)
    else:
        index = generate_capacity_corpus(
            args.output_dir,
            args.case,
            golden_release=args.golden_release,
            schema_dir=args.schema_dir,
        )
    print(index)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
