"""Build a self-contained local review lab for legacy and reconstructed Top maps."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import html
import json
import math
import re
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Sequence

import numpy as np
import shapely

from tools.anatomy_pack.build import sha256_file
from tools.anatomy_pack.build_v2 import atlas_ids_for_row
from tools.anatomy_pack.geometry import geometry_path
from tools.anatomy_smoothing_lab import EvaluationPolicy, run_experiment
from tools.projection_pack.build import (
    PINNED_STATIC_SOURCES,
    _crosswalk,
    normalize_static_fragment,
)

FORMAT = "ibl-top-reconstruction-lab-v1"
REVIEW_FORMAT = "ibl-top-reconstruction-human-review-v2"
DEFAULT_RESOLUTION_UM = 25
RAW_SHAPES = {10: (1320, 1140, 800), 25: (528, 456, 320)}  # AP, ML, DV
LEGACY_VIEW_BOX = [60, 20, 340, 300]
IBLATLAS_COMMIT = "52083adf44825d0622a503705e095699a5957587"
DEFAULT_TOLERANCES_UM = (12.5, 25.0, 37.5)
DEFAULT_ANNOTATION_SHA256 = (
    "c620cbcc562183e4dcd40250d440130501781f74b41de35b1c1bdabace290c42"
)


def canonical_json(value: Any) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode()


def dorsal_surface_rows(
    raw_annotation: np.ndarray,
    regions: Any,
    *,
    resolution_um: int = DEFAULT_RESOLUTION_UM,
) -> np.ndarray:
    """Return the first non-background label viewed from dorsal to ventral.

    The pinned Allen grid is AP, ML, DV and its DV coordinate decreases as the
    array index increases. The first nonzero DV sample is therefore the dorsal
    visible label. The output uses physical bilateral BrainRegions rows.
    """
    raw = np.asarray(raw_annotation)
    if raw.ndim != 3:
        raise ValueError("annotation must have AP, ML, DV axes")
    visible = raw != 0
    first = np.argmax(visible, axis=2)
    surface_ids = np.take_along_axis(raw, first[..., None], axis=2)[..., 0]
    surface_ids[~np.any(visible, axis=2)] = 0

    hemisphere_size = (len(regions.id) - 1) // 2
    if hemisphere_size <= 0 or len(regions.id) != hemisphere_size * 2 + 1:
        raise ValueError("BrainRegions must contain matched bilateral rows")
    positive_ids = np.asarray(regions.id[1 : hemisphere_size + 1], dtype=np.int64)
    order = np.argsort(positive_ids)
    sorted_ids = positive_ids[order]
    sorted_rows = order.astype(np.int64) + 1
    result = np.zeros(surface_ids.shape, dtype=np.int32)
    nonzero = surface_ids != 0
    values = surface_ids[nonzero].astype(np.int64, copy=False)
    positions = np.searchsorted(sorted_ids, values)
    if np.any(positions == len(sorted_ids)) or np.any(sorted_ids[positions] != values):
        raise ValueError("annotation surface contains an ID absent from BrainRegions")
    result[nonzero] = sorted_rows[positions]

    # Allen's ML origin is -5739 um. Match the pinned iblatlas lateralization
    # rule: indices before floor(5739 / resolution) are physical left.
    left_stop = int(math.floor(5739 / resolution_um))
    left = result[:, :left_stop]
    left[left != 0] += hemisphere_size
    return result


def dorsal_surface_rows_from_lut(
    bilateral_rows: np.ndarray,
    regions: Any,
    *,
    block_size: int = 32,
    progress: Any | None = None,
) -> np.ndarray:
    """Extract a dorsal surface from a memory-mappable bilateral row LUT."""
    labels = bilateral_rows
    if labels.ndim != 3:
        raise ValueError("bilateral LUT must have AP, ML, DV axes")
    if block_size <= 0:
        raise ValueError("block_size must be positive")
    output = np.zeros(labels.shape[:2], dtype=np.int32)
    for first_ap in range(0, labels.shape[0], block_size):
        last_ap = min(first_ap + block_size, labels.shape[0])
        block = np.asarray(labels[first_ap:last_ap])
        visible = block != 0
        first_dv = np.argmax(visible, axis=2)
        surface = np.take_along_axis(block, first_dv[..., None], axis=2)[..., 0]
        surface[~np.any(visible, axis=2)] = 0
        output[first_ap:last_ap] = surface
        if progress is not None:
            progress(last_ap, labels.shape[0])
    nonzero = output[output != 0]
    if nonzero.size and (
        int(nonzero.min()) < 1 or int(nonzero.max()) >= len(regions.id)
    ):
        raise ValueError("bilateral LUT surface contains a row outside BrainRegions")
    return output


def _fragment(geometries: dict[int, Any], regions: Any) -> str:
    paths: list[str] = []
    for row, geometry in sorted(geometries.items()):
        atlas_ids = atlas_ids_for_row(regions, row)
        paths.append(
            '<path class="atlas-region" fill-rule="evenodd" '
            f'data-allen-id="{atlas_ids["allen"]}" '
            f'data-beryl-id="{atlas_ids["beryl"]}" '
            f'data-cosmos-id="{atlas_ids["cosmos"]}" '
            f'd="{html.escape(geometry_path(geometry), quote=True)}"/>'
        )
    return "".join(paths)


def _region_metadata(rows: Sequence[int], regions: Any) -> dict[str, Any]:
    output: dict[str, Any] = {}
    for row in rows:
        atlas_ids = atlas_ids_for_row(regions, row)
        rgb = [int(value) for value in regions.rgb[row]]
        output[str(atlas_ids["allen"])] = {
            "atlas_ids": atlas_ids,
            "acronym": str(regions.acronym[row]),
            "name": str(regions.name[row]),
            "color": "#" + "".join(f"{value:02x}" for value in rgb),
        }
    return output


def _variant(
    plane: np.ndarray,
    regions: Any,
    *,
    strategy_id: str,
    parameters: dict[str, Any],
    policy: EvaluationPolicy,
    resolution_um: int,
) -> dict[str, Any]:
    result = run_experiment(
        plane,
        strategy_id=strategy_id,
        parameters=parameters,
        resolution_um=resolution_um,
        policy=policy,
    )
    record = result.deterministic_record()
    fragment = (
        _fragment(result.geometries_by_label, regions)
        if result.geometries_by_label is not None
        else None
    )
    raw = fragment.encode() if fragment is not None else b""
    tolerance = float(parameters.get("tolerance_um", 0))
    suffix = "" if resolution_um == 25 else f"-{resolution_um}um"
    if strategy_id == "exact":
        identifier = f"reconstructed-exact{suffix}"
        label = f"Reconstructed exact {resolution_um} µm"
        conservative_rank = 0.0
    elif strategy_id == "geos-coverage-simplify":
        identifier = f"coverage-{tolerance:g}um{suffix}"
        label = (
            f"{resolution_um} µm source · coverage-safe {tolerance:g} µm simplification"
        )
        conservative_rank = tolerance
    elif strategy_id == "shared-boundary-laplacian":
        iterations = int(parameters["iterations"])
        strength = float(parameters["strength"])
        pass_label = "pass" if iterations == 1 else "passes"
        identifier = f"shared-smooth-{iterations}pass-strength-{strength:g}{suffix}"
        label = (
            f"{resolution_um} µm source · shared-boundary smoothing "
            f"{iterations} {pass_label} at {strength:g} strength"
        )
        conservative_rank = iterations * strength
    else:
        raise ValueError(f"unsupported Top reconstruction strategy {strategy_id!r}")
    return {
        "id": identifier,
        "label": label,
        "strategy_id": strategy_id,
        "parameters": parameters,
        "eligibility": record["eligibility"],
        "generation_failure": record["generation_failure"],
        "metrics": record["metrics"],
        "svg_fragment": fragment,
        "view_box": [-0.5, -0.5, int(plane.shape[1]), int(plane.shape[0])],
        "encoded_sizes": {
            "raw_utf8_bytes": len(raw),
            "gzip_9_bytes": len(gzip.compress(raw, compresslevel=9, mtime=0)),
        },
        "conservative_rank": conservative_rank,
    }


def build_report(
    surface_rows: np.ndarray,
    regions: Any,
    legacy_fragment: str,
    *,
    tolerances_um: Sequence[float] = DEFAULT_TOLERANCES_UM,
    created_at: str,
    source: dict[str, Any],
    generator: dict[str, Any],
    resolution_um: int = DEFAULT_RESOLUTION_UM,
    smoothing_passes: Sequence[int] = (),
    smoothing_strength: float = 0.25,
) -> dict[str, Any]:
    plane = np.asarray(surface_rows, dtype=np.int32)
    if plane.ndim != 2 or not np.any(plane):
        raise ValueError("dorsal surface must be one nonempty two-dimensional plane")
    if resolution_um not in RAW_SHAPES:
        raise ValueError(f"unsupported Allen resolution {resolution_um} um")
    tolerances = tuple(sorted(set(float(value) for value in tolerances_um)))
    if any(not math.isfinite(value) or value <= 0 for value in tolerances):
        raise ValueError("candidate tolerances must be finite and positive")
    passes = tuple(sorted(set(smoothing_passes)))
    if any(
        isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= 32
        for value in passes
    ):
        raise ValueError("smoothing passes must be integers between 1 and 32")
    if not math.isfinite(smoothing_strength) or not 0 < smoothing_strength <= 0.5:
        raise ValueError("smoothing strength must be finite and in (0, 0.5]")
    policy = EvaluationPolicy(
        maximum_error_um=2 * resolution_um,
        minimum_iou=0.98,
        minimum_iou_area_um2=10_000,
    )
    variants = [
        _variant(
            plane,
            regions,
            strategy_id="exact",
            parameters={},
            policy=policy,
            resolution_um=resolution_um,
        )
    ]
    variants.extend(
        _variant(
            plane,
            regions,
            strategy_id="geos-coverage-simplify",
            parameters={"tolerance_um": tolerance, "simplify_boundary": False},
            policy=policy,
            resolution_um=resolution_um,
        )
        for tolerance in tolerances
    )
    variants.extend(
        _variant(
            plane,
            regions,
            strategy_id="shared-boundary-laplacian",
            parameters={"iterations": iterations, "strength": smoothing_strength},
            policy=policy,
            resolution_um=resolution_um,
        )
        for iterations in passes
    )
    rows = sorted(int(value) for value in np.unique(plane) if int(value) != 0)
    metadata = _region_metadata(rows, regions)
    legacy_ids = sorted(
        {
            int(value)
            for value in re.findall(r'data-allen-id="(-?\d+)"', legacy_fragment)
        }
    )
    candidate_ids = sorted(int(value) for value in metadata)
    identity: dict[str, Any] = {
        "format": FORMAT,
        "surface_labels_sha256": source["surface_labels"]["sha256"],
        "legacy_top_sha256": source["legacy_top"]["sha256"],
        "resolution_um": resolution_um,
        "tolerances_um": list(tolerances),
        "generator_commit": generator["commit"],
    }
    if passes:
        identity.update(
            smoothing_passes=list(passes),
            smoothing_strength=smoothing_strength,
        )
    return {
        "format": FORMAT,
        "review_id": hashlib.sha256(canonical_json(identity)).hexdigest(),
        "created_at": created_at,
        "status": "local review evidence only; no production asset is selected or changed",
        "question": "How do these Top geometries differ?",
        "review_criteria": [
            {"id": "boundary_continuity", "label": "Boundary continuity / holes"},
            {"id": "smoothing_quality", "label": "Smoothing quality"},
            {"id": "anatomical_shape", "label": "Anatomical shape"},
        ],
        "criterion_options": ["a-better", "no-difference", "b-better"],
        "disposition_options": [
            "prefer-a",
            "no-difference",
            "needs-refinement",
            "prefer-b",
        ],
        "legacy": {
            "id": "legacy-top",
            "label": "Legacy Top",
            "svg_fragment": legacy_fragment,
            "view_box": LEGACY_VIEW_BOX,
            "path_count": legacy_fragment.count("<path "),
            "allen_ids": legacy_ids,
            "limitations": "Curated cubic paths; source-plane topology cannot be proven from the surviving simplified SVG.",
        },
        "candidates": variants,
        "region_metadata": metadata,
        "inventory": {
            "legacy_signed_allen_ids": legacy_ids,
            "candidate_signed_allen_ids": candidate_ids,
            "only_in_legacy": sorted(set(legacy_ids) - set(candidate_ids)),
            "only_in_candidate": sorted(set(candidate_ids) - set(legacy_ids)),
        },
        "source": source,
        "provenance": {
            "generator": generator,
            "iblatlas_commit": IBLATLAS_COMMIT,
            "shapely_version": shapely.__version__,
            "geos_version": shapely.geos_version_string,
            "projection_recipe": (
                "first non-background AP×ML label while scanning DV index "
                f"0→{RAW_SHAPES[resolution_um][2] - 1} (dorsal→ventral)"
            ),
            "resolution_um": resolution_um,
        },
        "decision_rule": {
            "screening": "Legacy is A/left and each reconstruction is B/right.",
            "finalists": "Every prefer-B reconstruction enters an adaptive pairwise finalist round.",
            "refinement": "If no candidate advances and any comparison requests refinement, recommend another variant rather than forcing A or B.",
            "no_difference": "Keep the lower-tolerance (more conservative) finalist.",
            "promotion": "The result is a recommendation only; production replacement requires a separate reviewed decision.",
        },
        "display_registration": {
            "method": "independent geometry-bounds fit with 3 percent padding",
            "purpose": "align projected silhouettes for visual comparison only",
            "scientific_affine_claim": False,
        },
        "review_record_format": REVIEW_FORMAT,
    }


def render_report(report: dict[str, Any], template: str) -> bytes:
    marker = "__TOP_RECONSTRUCTION_LAB_DATA__"
    if template.count(marker) != 1:
        raise ValueError(
            "Top reconstruction template must contain exactly one data marker"
        )
    if "<script src=" in template or "<link rel=" in template:
        raise ValueError("Top reconstruction report must be self-contained")
    payload = canonical_json(report).decode().replace("</", "<\\/")
    return template.replace(marker, payload).encode()


def validated_lut_parent(
    manifest_path: Path,
    lut_path: Path,
    *,
    lut_sha256: str,
    resolution_um: int,
) -> dict[str, Any]:
    """Bind a large external LUT to the committed validated parent evidence."""
    manifest_raw = manifest_path.read_bytes()
    manifest = json.loads(manifest_raw)
    if (
        manifest.get("format") != "anatomy-pack-v2"
        or manifest.get("immutable") is not True
    ):
        raise ValueError("source parent must be one immutable anatomy-pack-v2 manifest")
    source = manifest.get("source")
    validation = manifest.get("validation")
    if not isinstance(source, dict) or source.get("resolution_um") != resolution_um:
        raise ValueError("source parent resolution differs from the requested LUT")
    lut = source.get("region_lut")
    if (
        not isinstance(lut, dict)
        or lut.get("sha256") != lut_sha256
        or lut.get("bytes") != lut_path.stat().st_size
        or Path(str(lut.get("path"))).name != lut_path.name
    ):
        raise ValueError("source LUT does not match the canonical parent evidence")
    annotation = source.get("annotation")
    if not isinstance(annotation, dict) or not re.fullmatch(
        r"[0-9a-f]{64}", str(annotation.get("sha256"))
    ):
        raise ValueError("source parent lacks a hash-pinned annotation")
    required_gates = {
        "topology_valid": True,
        "coverage_valid": True,
        "background_topology_valid": True,
        "adjacency_mismatches": 0,
        "invalid_geometries": 0,
        "multiply_covered_voxels": 0,
        "uncovered_voxels": 0,
    }
    if not isinstance(validation, dict) or any(
        validation.get(key) != expected for key, expected in required_gates.items()
    ):
        raise ValueError("source parent did not pass canonical anatomy gates")
    return {
        "pack_id": manifest["pack_id"],
        "manifest_sha256": hashlib.sha256(manifest_raw).hexdigest(),
        "annotation": annotation,
        "generator": manifest.get("provenance", {}).get("generator"),
    }


def _git_state(repository: Path) -> dict[str, Any]:
    commit = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=repository,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    dirty = bool(
        subprocess.run(
            ["git", "status", "--porcelain", "--untracked-files=no"],
            cwd=repository,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
    )
    return {
        "repository": "rossant/ibl-ephys-atlas-web-v2",
        "commit": commit,
        "dirty": dirty,
    }


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--annotation", type=Path)
    source.add_argument("--source-lut", type=Path)
    parser.add_argument("--annotation-sha256", default=DEFAULT_ANNOTATION_SHA256)
    parser.add_argument("--source-lut-sha256")
    parser.add_argument("--source-parent-manifest", type=Path)
    parser.add_argument(
        "--resolution-um", type=int, choices=sorted(RAW_SHAPES), default=25
    )
    parser.add_argument("--legacy-top", type=Path, required=True)
    parser.add_argument("--regions", type=Path, required=True)
    parser.add_argument("--created-at", required=True)
    parser.add_argument(
        "--tolerances-um", default=",".join(map(str, DEFAULT_TOLERANCES_UM))
    )
    parser.add_argument("--smoothing-passes", default="")
    parser.add_argument("--smoothing-strength", type=float, default=0.25)
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("artifacts/top-reconstruction-lab/index.html"),
    )
    parser.add_argument(
        "--template", type=Path, default=Path(__file__).with_name("template.html")
    )
    args = parser.parse_args(argv)
    if args.source_lut is not None and not args.source_lut_sha256:
        parser.error("--source-lut requires --source-lut-sha256")
    if args.source_lut is not None and args.source_parent_manifest is None:
        parser.error("--source-lut requires --source-parent-manifest")
    if args.annotation is not None and args.source_parent_manifest is not None:
        parser.error("--source-parent-manifest applies only to --source-lut")
    return args


def main(argv: Sequence[str] | None = None) -> int:
    from iblatlas.atlas import AllenAtlas
    from iblatlas.regions import BrainRegions

    args = parse_args(argv)
    repository = Path(__file__).resolve().parents[2]
    allowed = (repository / "artifacts/top-reconstruction-lab").resolve()
    output = args.output.resolve()
    if output != allowed and allowed not in output.parents:
        raise ValueError(
            "review output must stay under artifacts/top-reconstruction-lab"
        )
    source_path = args.source_lut or args.annotation
    assert source_path is not None
    expected_source_sha = args.source_lut_sha256 or args.annotation_sha256
    source_sha = sha256_file(source_path)
    if source_sha != expected_source_sha:
        raise ValueError("Allen surface-label source SHA-256 mismatch")
    evidence = PINNED_STATIC_SOURCES["top"]
    legacy_raw = args.legacy_top.read_bytes()
    if (
        len(legacy_raw) != evidence.bytes
        or hashlib.sha256(legacy_raw).hexdigest() != evidence.sha256
    ):
        raise ValueError("legacy Top bytes do not match pinned evidence")
    crosswalk, regions_sha = _crosswalk(args.regions)
    payload = json.loads(legacy_raw)
    legacy_fragment, path_count = normalize_static_fragment(payload["0"], crosswalk)
    if path_count != evidence.path_count:
        raise ValueError("legacy Top path inventory differs")
    regions = BrainRegions()
    expected_shape = RAW_SHAPES[args.resolution_um]
    if args.source_lut is not None:
        parent_evidence = validated_lut_parent(
            args.source_parent_manifest,
            args.source_lut,
            lut_sha256=source_sha,
            resolution_um=args.resolution_um,
        )
        labels = np.load(args.source_lut, mmap_mode="r")
        if labels.shape != expected_shape or labels.dtype != np.uint16:
            raise ValueError(
                f"expected {args.resolution_um} um bilateral LUT shape/dtype "
                f"{expected_shape}/uint16, got {labels.shape}/{labels.dtype}"
            )
        plane = dorsal_surface_rows_from_lut(
            labels,
            regions,
            progress=lambda done, total: print(
                f"dorsal surface: {done}/{total} AP rows", flush=True
            ),
        )
        source_kind = "bilateral-brainregions-row-lut"
    else:
        parent_evidence = None
        raw = AllenAtlas._read_volume(args.annotation)
        if raw.shape != expected_shape:
            raise ValueError(
                f"expected {args.resolution_um} um annotation shape {expected_shape}, got {raw.shape}"
            )
        plane = dorsal_surface_rows(raw, regions, resolution_um=args.resolution_um)
        source_kind = "raw-allen-annotation"
    tolerances = tuple(
        float(value.strip()) for value in args.tolerances_um.split(",") if value.strip()
    )
    smoothing_passes = tuple(
        int(value.strip())
        for value in args.smoothing_passes.split(",")
        if value.strip()
    )
    report = build_report(
        plane,
        regions,
        legacy_fragment,
        tolerances_um=tolerances,
        created_at=args.created_at,
        source={
            "surface_labels": {
                "kind": source_kind,
                "path": source_path.name,
                "bytes": source_path.stat().st_size,
                "sha256": source_sha,
                "canonical_parent": parent_evidence,
            },
            "legacy_top": {
                "path": args.legacy_top.name,
                "bytes": len(legacy_raw),
                "sha256": evidence.sha256,
            },
            "regions": {
                "path": args.regions.name,
                "bytes": args.regions.stat().st_size,
                "sha256": regions_sha,
            },
        },
        generator=_git_state(repository),
        resolution_um=args.resolution_um,
        smoothing_passes=smoothing_passes,
        smoothing_strength=args.smoothing_strength,
    )
    rendered = render_report(report, args.template.read_text())
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        prefix=f".{output.name}-", dir=output.parent, delete=False
    ) as temporary:
        temporary.write(rendered)
        temporary_path = Path(temporary.name)
    temporary_path.replace(output)
    print(
        f"Wrote {output} ({len(rendered):,} bytes; {len(report['candidates'])} candidates)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
