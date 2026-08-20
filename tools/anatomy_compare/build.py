"""Build a self-contained old/new Allen anatomy SVG comparison report.

The old curated SVG is a visual reference only: it has no authoritative
world-to-view transform. Quantitative errors compare each simplified candidate
with the unsimplified contour extracted from the same annotation slice.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import math
import subprocess
import urllib.request
from collections.abc import Sequence
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from itertools import pairwise
from pathlib import Path
from typing import Any

import numpy as np

LEGACY_BASE_URL = "https://atlas.internationalbrainlab.org/data/json/"
LEGACY_SHA256 = {
    "coronal": "d237f222830791b4f4fc44b0f3d49aa86f3fe4a34988f480ec492b66b4b3dff2",
    "sagittal": "5a32a2669cea9e5b73f3df39f9781d66fd6a4bfeffe4ac6639adcae34bcb8c4e",
    "horizontal": "f553ae1fb3eac079851e5adbcaa37e52db8e3660552737cd61c52f09033a5ed2",
}


@dataclass(frozen=True)
class AxisSpec:
    name: str
    regional_count: int
    origin_um: int
    direction: int
    legacy_view_box: tuple[int, int, int, int]
    sample_indices: tuple[int, ...]


AXES: dict[str, AxisSpec] = {
    "coronal": AxisSpec("coronal", 1320, 5400, -1, (58, 50, 356, 250), (330, 660, 990)),
    "sagittal": AxisSpec(
        "sagittal", 1140, -5739, 1, (56, 66, 358, 217), (285, 550, 855)
    ),
    "horizontal": AxisSpec(
        "horizontal", 800, 332, -1, (122, 42, 230, 266), (200, 400, 600)
    ),
}


@dataclass(frozen=True)
class GeometryMetrics:
    tolerance_um: float
    regions: int
    rings: int
    vertices_before: int
    vertices_after: int
    median_error_um: float
    p95_error_um: float
    max_error_um: float
    raw_bytes: int
    gzip_bytes: int
    brotli_bytes: int | None
    topology_validated: bool


def _distance_to_segment(
    points: np.ndarray, start: np.ndarray, end: np.ndarray
) -> np.ndarray:
    delta = end - start
    denominator = float(np.dot(delta, delta))
    if denominator == 0:
        return np.linalg.norm(points - start, axis=1)
    projection = np.clip(((points - start) @ delta) / denominator, 0.0, 1.0)
    nearest = start + projection[:, None] * delta
    return np.linalg.norm(points - nearest, axis=1)


def simplify_open_line(points: np.ndarray, tolerance: float) -> np.ndarray:
    """Return a deterministic Ramer-Douglas-Peucker simplification."""
    if tolerance <= 0 or len(points) <= 2:
        return points.copy()
    keep = np.zeros(len(points), dtype=bool)
    keep[[0, -1]] = True
    stack = [(0, len(points) - 1)]
    while stack:
        first, last = stack.pop()
        if last <= first + 1:
            continue
        distances = _distance_to_segment(
            points[first + 1 : last], points[first], points[last]
        )
        relative = int(np.argmax(distances))
        distance = float(distances[relative])
        if distance > tolerance:
            split = first + 1 + relative
            keep[split] = True
            stack.append((split, last))
            stack.append((first, split))
    return points[keep]


def simplify_ring(points: np.ndarray, tolerance: float) -> np.ndarray:
    """Simplify a closed ring without the degenerate equal-endpoint baseline."""
    if len(points) < 4:
        return points.copy()
    closed = np.allclose(points[0], points[-1])
    core = points[:-1] if closed else points
    if tolerance <= 0 or len(core) < 4:
        return np.vstack((core, core[0]))
    anchor = int(np.argmax(np.sum((core - core[0]) ** 2, axis=1)))
    if anchor in (0, len(core) - 1):
        anchor = len(core) // 2
    first = simplify_open_line(core[: anchor + 1], tolerance)
    second_input = np.vstack((core[anchor:], core[0]))
    second = simplify_open_line(second_input, tolerance)
    simplified = np.vstack((first, second[1:]))
    if len(simplified) < 4:
        return np.vstack((core, core[0]))
    if not np.allclose(simplified[0], simplified[-1]):
        simplified = np.vstack((simplified, simplified[0]))
    return simplified


def point_to_polyline_distances(points: np.ndarray, polyline: np.ndarray) -> np.ndarray:
    """Compute each point's minimum distance to a polyline in bounded memory."""
    if len(polyline) < 2:
        return np.linalg.norm(points - polyline[0], axis=1)
    result = np.full(len(points), np.inf)
    for start, end in pairwise(polyline):
        result = np.minimum(result, _distance_to_segment(points, start, end))
    return result


def _format_coordinate(value: float) -> str:
    doubled = round(float(value) * 2)
    if math.isclose(float(value) * 2, doubled, abs_tol=1e-6):
        return str(doubled // 2) if doubled % 2 == 0 else f"{doubled / 2:.1f}"
    return f"{value:.3f}".rstrip("0").rstrip(".")


def ring_path(points: np.ndarray) -> str:
    if len(points) < 4:
        return ""
    pairs = [f"{_format_coordinate(x)} {_format_coordinate(y)}" for y, x in points]
    return f"M{pairs[0]}L{' '.join(pairs[1:-1])}Z"


def _contours(mask: np.ndarray) -> list[np.ndarray]:
    try:
        from skimage.measure import find_contours
    except ImportError as exc:  # pragma: no cover - exercised by CLI environment
        raise RuntimeError(
            "anatomy comparison requires scikit-image; run with the builder anatomy extra"
        ) from exc
    # Padding closes regions that touch the plane edge. Without it,
    # find_contours returns open lines and a later closing segment would cut
    # across the anatomy rather than follow the image boundary.
    padded = np.pad(mask, 1, mode="constant", constant_values=False)
    return [
        np.asarray(contour, dtype=np.float64) - 1
        for contour in find_contours(
            padded, 0.5, fully_connected="low", positive_orientation="low"
        )
        if len(contour) >= 4
    ]


def _compressed_sizes(payload: bytes) -> tuple[int, int, int | None]:
    gzip_bytes = len(gzip.compress(payload, compresslevel=9, mtime=0))
    try:
        import brotli
    except ImportError:  # pragma: no cover - optional outside the anatomy environment
        brotli_bytes = None
    else:
        brotli_bytes = len(brotli.compress(payload, quality=11, mode=brotli.MODE_TEXT))
    return len(payload), gzip_bytes, brotli_bytes


def extract_plane_contours(plane: np.ndarray) -> dict[int, list[np.ndarray]]:
    """Extract the unsimplified contour corpus once for a label plane."""
    return {
        int(region_index): _contours(plane == region_index)
        for region_index in np.unique(plane)
        if int(region_index) != 0
    }


def vectorize_contours(
    contours_by_region: dict[int, list[np.ndarray]],
    *,
    resolution_um: int,
    tolerance_um: float,
) -> tuple[str, GeometryMetrics]:
    """Vectorize one label-index plane and measure simplification error."""
    tolerance_pixels = tolerance_um / resolution_um
    fragments: list[str] = []
    errors: list[np.ndarray] = []
    vertices_before = 0
    vertices_after = 0
    ring_count = 0
    region_count = 0

    for region, contours in contours_by_region.items():
        paths: list[str] = []
        for contour in contours:
            if not np.allclose(contour[0], contour[-1]):
                contour = np.vstack((contour, contour[0]))
            simplified = simplify_ring(contour, tolerance_pixels)
            path = ring_path(simplified)
            if not path:
                continue
            paths.append(path)
            ring_count += 1
            vertices_before += len(contour) - 1
            vertices_after += len(simplified) - 1
            if tolerance_pixels > 0:
                errors.append(
                    point_to_polyline_distances(contour[:-1], simplified)
                    * resolution_um
                )
        if not paths:
            continue
        region_count += 1
        fragments.append(
            f'<path class="atlas-region allen_region_{region}" data-region-index="{region}" '
            f'fill-rule="evenodd" d="{"".join(paths)}"/>'
        )

    fragment = "".join(fragments)
    raw_bytes, gzip_bytes, brotli_bytes = _compressed_sizes(fragment.encode())
    all_errors = np.concatenate(errors) if errors else np.zeros(1)
    metrics = GeometryMetrics(
        tolerance_um=float(tolerance_um),
        regions=region_count,
        rings=ring_count,
        vertices_before=vertices_before,
        vertices_after=vertices_after,
        median_error_um=float(np.median(all_errors)),
        p95_error_um=float(np.percentile(all_errors, 95)),
        max_error_um=float(np.max(all_errors)),
        raw_bytes=raw_bytes,
        gzip_bytes=gzip_bytes,
        brotli_bytes=brotli_bytes,
        # Candidate rings are simplified independently in this pilot. Tolerance
        # is quantitatively bounded, but shared-edge topology still requires the
        # production chain-based implementation and validator.
        topology_validated=False,
    )
    return fragment, metrics


def vectorize_plane(
    plane: np.ndarray,
    *,
    resolution_um: int,
    tolerance_um: float,
) -> tuple[str, GeometryMetrics]:
    return vectorize_contours(
        extract_plane_contours(plane),
        resolution_um=resolution_um,
        tolerance_um=tolerance_um,
    )


def coordinate_um(axis: str, regional_index: int) -> int:
    spec = AXES[axis]
    return spec.origin_um + spec.direction * 10 * regional_index


def atlas_index(axis: str, regional_index: int, resolution_um: int, count: int) -> int:
    coordinate = coordinate_um(axis, regional_index)
    spec = AXES[axis]
    raw = (coordinate - spec.origin_um) / (spec.direction * resolution_um)
    return min(count - 1, max(0, round(raw)))


def plane_for_axis(label: np.ndarray, axis: str, index: int) -> np.ndarray:
    """Return a display-oriented plane: rows are SVG y and columns are SVG x."""
    if axis == "coronal":
        return label[index, :, :].T
    if axis == "sagittal":
        # The legacy sagittal artwork displays the atlas AP direction from the
        # opposite side. This flip is display-only; source indices and world
        # coordinates remain in atlas space.
        return np.flip(label[:, index, :].T, axis=1)
    if axis == "horizontal":
        return label[:, :, index]
    raise ValueError(f"Unknown slice axis {axis}")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def fetch_legacy_bundle(axis: str, cache_dir: Path, *, offline: bool) -> dict[str, str]:
    cache_dir.mkdir(parents=True, exist_ok=True)
    path = cache_dir / f"slices_{axis}.json"
    expected = LEGACY_SHA256[axis]
    if not path.exists():
        if offline:
            raise FileNotFoundError(f"Missing offline legacy bundle {path}")
        temporary = path.with_suffix(".json.tmp")
        url = f"{LEGACY_BASE_URL}slices_{axis}.json"
        with (
            urllib.request.urlopen(url, timeout=60) as response,
            temporary.open("wb") as output,
        ):
            while chunk := response.read(1024 * 1024):
                output.write(chunk)
        temporary.replace(path)
    actual = sha256_file(path)
    if actual != expected:
        raise ValueError(
            f"Legacy {axis} SHA-256 mismatch: expected {expected}, got {actual}"
        )
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict) or not all(
        isinstance(key, str) and isinstance(value, str) for key, value in raw.items()
    ):
        raise ValueError(f"Invalid legacy {axis} bundle")
    return raw


def nearest_legacy_fragment(bundle: dict[str, str], requested: int) -> tuple[int, str]:
    indices = sorted(int(key) for key in bundle)
    selected = min(indices, key=lambda index: (abs(index - requested), index))
    return selected, bundle[str(selected)]


def _atlas_metadata(atlas: Any, resolution_um: int) -> dict[str, Any]:
    try:
        import iblatlas

        version = getattr(iblatlas, "__version__", "unknown")
    except ImportError:  # pragma: no cover
        version = "unknown"
    cache_dir = Path(atlas._get_cache_dir())
    annotation_path = cache_dir / f"annotation_{resolution_um}.nrrd"
    annotation_lut_path = cache_dir / f"annotation_{resolution_um}_lut_v01.npz"
    repository_root = Path(__file__).resolve().parents[2]
    generator_commit = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=repository_root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    generator_dirty = bool(
        subprocess.run(
            ["git", "status", "--porcelain", "--untracked-files=no"],
            cwd=repository_root,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
    )
    return {
        "name": "Allen Mouse CCF 2017 via iblatlas",
        "resolutionUm": resolution_um,
        "iblatlasVersion": version,
        "iblatlasCommit": "52083adf44825d0622a503705e095699a5957587",
        "generatorCommit": generator_commit,
        "generatorDirty": generator_dirty,
        "emittedRegionIdDomain": "lateralized BrainRegions row index, not Allen atlas ID",
        "labelShape": list(map(int, atlas.label.shape)),
        "axisOrder": ["coronal_ap", "sagittal_ml", "horizontal_dv"],
        "annotationFile": annotation_path.name,
        "annotationSha256": sha256_file(annotation_path)
        if annotation_path.exists()
        else None,
        "annotationLutFile": annotation_lut_path.name,
        "annotationLutSha256": sha256_file(annotation_lut_path)
        if annotation_lut_path.exists()
        else None,
        "indexToWorldUm": [
            0,
            resolution_um,
            0,
            AXES["sagittal"].origin_um,
            -resolution_um,
            0,
            0,
            AXES["coronal"].origin_um,
            0,
            0,
            -resolution_um,
            AXES["horizontal"].origin_um,
            0,
            0,
            0,
            1,
        ],
    }


def build_report_data(
    *,
    resolution_um: int,
    tolerances_um: Sequence[float],
    cache_dir: Path,
    offline: bool,
    created_at: str,
) -> dict[str, Any]:
    try:
        from iblatlas.atlas import AllenAtlas
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError(
            "anatomy comparison requires iblatlas; run with the builder anatomy extra"
        ) from exc

    atlas = AllenAtlas(res_um=resolution_um)
    label = np.asarray(atlas.label)
    bundles = {
        axis: fetch_legacy_bundle(axis, cache_dir, offline=offline) for axis in AXES
    }
    axes: dict[str, Any] = {}
    for axis, spec in AXES.items():
        axis_number = {"coronal": 0, "sagittal": 1, "horizontal": 2}[axis]
        samples: list[dict[str, Any]] = []
        for regional_index in spec.sample_indices:
            source_index = atlas_index(
                axis, regional_index, resolution_um, label.shape[axis_number]
            )
            plane = plane_for_axis(label, axis, source_index)
            contours_by_region = extract_plane_contours(plane)
            legacy_index, legacy_fragment = nearest_legacy_fragment(
                bundles[axis], regional_index
            )
            variants = []
            for tolerance_um in tolerances_um:
                fragment, metrics = vectorize_contours(
                    contours_by_region,
                    resolution_um=resolution_um,
                    tolerance_um=tolerance_um,
                )
                variants.append({"fragment": fragment, "metrics": asdict(metrics)})
            samples.append(
                {
                    "regionalIndex": regional_index,
                    "coordinateUm": coordinate_um(axis, regional_index),
                    "sourceIndex": source_index,
                    "sourceCoordinateUm": spec.origin_um
                    + spec.direction * resolution_um * source_index,
                    "legacyIndex": legacy_index,
                    "legacyFragment": legacy_fragment,
                    "newViewBox": [0, 0, int(plane.shape[1]), int(plane.shape[0])],
                    "variants": variants,
                }
            )
        sample_pack_metrics = []
        for variant_index, tolerance_um in enumerate(tolerances_um):
            pack = json.dumps(
                [sample["variants"][variant_index]["fragment"] for sample in samples],
                separators=(",", ":"),
            ).encode()
            raw_bytes, gzip_bytes, brotli_bytes = _compressed_sizes(pack)
            sample_pack_metrics.append(
                {
                    "toleranceUm": tolerance_um,
                    "sliceCount": len(samples),
                    "rawBytes": raw_bytes,
                    "gzipBytes": gzip_bytes,
                    "brotliBytes": brotli_bytes,
                }
            )
        axes[axis] = {
            "legacyViewBox": list(spec.legacy_view_box),
            "samples": samples,
            "samplePackMetrics": sample_pack_metrics,
        }
    return {
        "schema": "ibl-anatomy-comparison-v0.1",
        "createdAt": created_at,
        "source": _atlas_metadata(atlas, resolution_um),
        "legacy": {
            "baseUrl": LEGACY_BASE_URL,
            "sha256": LEGACY_SHA256,
            "quantitativeUse": False,
        },
        "tolerancesUm": list(map(float, tolerances_um)),
        "axes": axes,
    }


def write_report(data: dict[str, Any], template_path: Path, output_path: Path) -> None:
    template = template_path.read_text(encoding="utf-8")
    encoded = json.dumps(data, separators=(",", ":"), ensure_ascii=False).replace(
        "</", "<\\/"
    )
    if "__ANATOMY_COMPARISON_DATA__" not in template:
        raise ValueError("Comparison template is missing its data placeholder")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        template.replace("__ANATOMY_COMPARISON_DATA__", encoded), encoding="utf-8"
    )


def _parse_tolerances(value: str) -> tuple[float, ...]:
    tolerances = tuple(float(item.strip()) for item in value.split(",") if item.strip())
    if not tolerances or tolerances[0] != 0 or any(value < 0 for value in tolerances):
        raise argparse.ArgumentTypeError(
            "tolerances must start at 0 and be non-negative"
        )
    if len(set(tolerances)) != len(tolerances):
        raise argparse.ArgumentTypeError("tolerances must be unique")
    return tolerances


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--resolution", type=int, choices=(10, 25, 50), default=25)
    parser.add_argument(
        "--tolerances-um", type=_parse_tolerances, default=(0.0, 5.0, 10.0, 20.0, 40.0)
    )
    parser.add_argument(
        "--cache-dir", type=Path, default=root / "artifacts/anatomy-cache"
    )
    parser.add_argument(
        "--output", type=Path, default=root / "artifacts/anatomy-compare.html"
    )
    parser.add_argument(
        "--template", type=Path, default=Path(__file__).with_name("template.html")
    )
    parser.add_argument("--offline", action="store_true")
    parser.add_argument(
        "--created-at",
        default=datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z"),
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    data = build_report_data(
        resolution_um=args.resolution,
        tolerances_um=args.tolerances_um,
        cache_dir=args.cache_dir,
        offline=args.offline,
        created_at=args.created_at,
    )
    write_report(data, args.template, args.output)
    print(f"Wrote {args.output} ({args.output.stat().st_size:,} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
