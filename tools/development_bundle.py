"""Validate the pinned local development bundle without network access."""

from __future__ import annotations

import argparse
from pathlib import Path

from ephys_atlas_builder.development_bundle import validate_development_bundle


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("descriptor", type=Path)
    arguments = parser.parse_args()
    bundle = validate_development_bundle(arguments.descriptor)
    print(
        f"validated {bundle.bundle_id}: {len(bundle.artifacts)} artifacts, "
        f"{sum(item.file_count for item in bundle.artifacts)} files, "
        f"{bundle.stored_bytes} bytes"
    )


if __name__ == "__main__":
    main()
