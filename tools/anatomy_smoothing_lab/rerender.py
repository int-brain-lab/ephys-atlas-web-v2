"""Reapply the current offline UI to an existing smoothing evidence report."""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import Sequence

from tools.anatomy_pack.build_v2 import canonical_json
from tools.anatomy_smoothing_lab.build import _atomic_write, render_report


DATA_OPEN = b'<script type="application/json" id="report-data">'
DATA_CLOSE = b"</script>"


def extract_embedded_report(rendered: bytes) -> bytes:
    """Return the canonical report JSON without recomputing scientific evidence."""
    if rendered.count(DATA_OPEN) != 1:
        raise ValueError("input must contain exactly one anatomy report payload")
    start = rendered.index(DATA_OPEN) + len(DATA_OPEN)
    end = rendered.find(DATA_CLOSE, start)
    if end < 0:
        raise ValueError("input anatomy report payload is not closed")
    payload = rendered[start:end]
    if b'"format":"ibl-anatomy-smoothing-lab-v1"' not in payload[:4096]:
        raise ValueError("input does not contain an anatomy smoothing v1 report")
    return payload


def rerender_report(input_path: Path, template_path: Path, output_path: Path) -> None:
    payload = extract_embedded_report(input_path.read_bytes())
    template = template_path.read_text()
    # Reuse render_report's offline-resource and single-marker audit with a tiny
    # placeholder, then substitute the already-escaped canonical payload bytes.
    placeholder = {"__rerender_payload_marker__": "anatomy-smoothing-lab"}
    shell = render_report(placeholder, template)
    encoded_placeholder = canonical_json(placeholder)
    if shell.count(encoded_placeholder) != 1:
        raise ValueError("report template placeholder is ambiguous")
    _atomic_write(output_path, shell.replace(encoded_placeholder, payload, 1))


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--template",
        type=Path,
        default=Path(__file__).with_name("template.html"),
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> None:
    args = parse_args(argv)
    rerender_report(args.input, args.template, args.output)
    print(f"re-rendered {args.output} from existing evidence {args.input}")


if __name__ == "__main__":
    main()
