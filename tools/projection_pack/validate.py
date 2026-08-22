"""Validate a complete atlas-projection-pack-v1 directory."""
from __future__ import annotations

import argparse
from pathlib import Path

from tools.projection_pack.build import validate_projection_pack


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", type=Path)
    args = parser.parse_args()
    validate_projection_pack(args.path)


if __name__ == "__main__":
    main()
