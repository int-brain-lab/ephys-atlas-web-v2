"""Build a deterministic, self-contained anatomy smoothing evidence report."""

from __future__ import annotations

import argparse
import base64
import gzip
import hashlib
import html
import json
import re
import subprocess
from collections import defaultdict
from collections.abc import Callable, Sequence
from dataclasses import asdict
from datetime import datetime
from pathlib import Path
from typing import Any

import numpy as np
import shapely
from jsonschema import Draft202012Validator
from shapely import get_coordinates
from shapely.geometry import box

from tools.anatomy_pack.build_v2 import (
    IBLATLAS_COMMIT,
    LABEL_SHAPE,
    PROJECTIONS,
    _validate_generated,
    atlas_ids_for_row,
    plane_for_projection,
)
from tools.anatomy_pack.geometry import (
    adjacency_pairs,
    geometry_path,
    geometry_path_relative,
    geometry_signature,
    raster_label_geometries,
)
from tools.anatomy_smoothing_lab.metrics import EvaluationPolicy
from tools.anatomy_smoothing_lab.strategies import (
    available_strategies,
    parse_tolerances_um,
    run_experiment,
)
from tools.anatomy_smoothing_lab.synthetic import synthetic_planes

FORMAT = "ibl-anatomy-smoothing-lab-v1"
PROJECTION_NAMES = ("coronal", "sagittal", "horizontal")
DEFAULT_PARENT = Path(
    "web/public/atlas/anatomy/allen-ccfv3-10um-bilateral-exact-599b5e0bbab1"
)
DEFAULT_SAMPLED = Path(
    "web/public/atlas/anatomy/"
    "allen-ccfv3-10um-bilateral-exact-599b5e0bbab1-display-80um-d8-f8277956e67a"
)
DEFAULT_TOLERANCES = "0,2.5,5,7.5,10,15,20"
DEFAULT_STRATEGIES = (
    "exact",
    "geos-coverage-simplify",
    "independent-ring-rdp-unsafe",
)


def canonical_json(value: Any) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        allow_nan=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode()


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def parse_indices(value: str) -> tuple[int, ...]:
    if not value.strip():
        return ()
    result: set[int] = set()
    for item in value.split(","):
        try:
            index = int(item.strip())
        except ValueError as exc:
            raise argparse.ArgumentTypeError("slice indices must be integers") from exc
        if index < 0:
            raise argparse.ArgumentTypeError("slice indices must be non-negative")
        result.add(index)
    return tuple(sorted(result))


def parse_strategy_ids(value: str) -> tuple[str, ...]:
    requested = tuple(dict.fromkeys(item.strip() for item in value.split(",") if item.strip()))
    known = {item.strategy_id for item in available_strategies()}
    if not requested:
        raise argparse.ArgumentTypeError("at least one strategy is required")
    unknown = sorted(set(requested) - known)
    if unknown:
        raise argparse.ArgumentTypeError(f"unknown strategies: {', '.join(unknown)}")
    return requested


def _created_at(value: str) -> str:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise argparse.ArgumentTypeError("created-at must be an RFC 3339 timestamp") from exc
    if parsed.tzinfo is None:
        raise argparse.ArgumentTypeError("created-at must include a timezone")
    return value


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--created-at", type=_created_at, required=True)
    parser.add_argument(
        "--strategies", type=parse_strategy_ids, default=DEFAULT_STRATEGIES
    )
    parser.add_argument(
        "--tolerances-um", type=parse_tolerances_um, default=parse_tolerances_um(DEFAULT_TOLERANCES)
    )
    parser.add_argument("--maximum-error-um", type=float, required=True)
    parser.add_argument("--minimum-iou", type=float, required=True)
    parser.add_argument("--minimum-iou-area-mm2", type=float, default=0.01)
    for projection in PROJECTION_NAMES:
        parser.add_argument(f"--{projection}-slices", type=parse_indices, default=())
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--synthetic", action="store_true")
    source.add_argument("--source-lut", type=Path)
    parser.add_argument("--annotation", type=Path)
    parser.add_argument("--template-volume", type=Path)
    parser.add_argument("--template-sha256")
    parser.add_argument("--template-source")
    parser.add_argument("--parent", type=Path, default=DEFAULT_PARENT)
    parser.add_argument("--sampled-pack", type=Path, default=DEFAULT_SAMPLED)
    parser.add_argument("--template", type=Path, default=Path(__file__).with_name("template.html"))
    parser.add_argument("--offline", action="store_true")
    args = parser.parse_args(argv)
    if not args.synthetic:
        missing = [
            name
            for name in ("annotation", "template_volume", "template_sha256", "template_source")
            if not getattr(args, name)
        ]
        if missing:
            parser.error("real mode requires " + ", ".join(f"--{name.replace('_', '-')}" for name in missing))
    return args


def _projection_world_coordinate(projection: dict[str, Any], index: int) -> float:
    axis = {"ml": 0, "ap": 1, "dv": 2}[projection["fixed_world_axis"]]
    matrix = projection["plane_index_to_world_um"]
    return float(matrix[axis * 4] * index + matrix[axis * 4 + 3])


def _plane_properties(
    plane: np.ndarray, signed_id_for_label: Callable[[int], int]
) -> dict[str, int]:
    exact = raster_label_geometries(plane)
    labels = sorted(exact)
    geometries = [exact[label] for label in labels]
    signatures = [geometry_signature(value) for value in geometries]
    height, width = plane.shape
    frame = box(-0.5, -0.5, width - 0.5, height - 0.5)
    signed = [signed_id_for_label(label) for label in labels]
    return {
        "region_count": len(labels),
        "vertices": sum(len(get_coordinates(value.boundary)) for value in geometries),
        "adjacencies": len(adjacency_pairs(geometries)),
        "components_holes": sum(components + holes for components, holes in signatures),
        "plane_edge_contacts": sum(
            not value.boundary.intersection(frame.boundary).is_empty for value in geometries
        ),
        "bilateral": int(any(value < 0 for value in signed) and any(value > 0 for value in signed)),
    }


def select_stress_samples(
    candidate_indices: Sequence[int],
    plane_for_index: Callable[[int], np.ndarray],
    signed_id_for_label: Callable[[int], int],
) -> dict[int, tuple[str, ...]]:
    """Choose deterministic stress samples with stable lower-index ties."""
    indices = tuple(sorted(set(candidate_indices)))
    if not indices:
        raise ValueError("stress selection requires at least one candidate slice")
    properties = {
        index: _plane_properties(plane_for_index(index), signed_id_for_label)
        for index in indices
    }
    reasons: dict[int, list[str]] = defaultdict(list)
    midpoint = (indices[0] + indices[-1]) / 2
    central = min(indices, key=lambda index: (abs(index - midpoint), index))
    reasons[central].append("central active-display plane")
    categories = (
        ("vertices", "highest exact boundary-vertex count"),
        ("region_count", "highest region count"),
        ("adjacencies", "highest shared-boundary adjacency count"),
        ("components_holes", "highest component-and-hole count"),
        ("plane_edge_contacts", "highest plane-edge contact count"),
        ("bilateral", "bilateral signed-ID coverage"),
    )
    for key, reason in categories:
        maximum = max(properties[index][key] for index in indices)
        if maximum <= 0:
            continue
        selected = min(index for index in indices if properties[index][key] == maximum)
        reasons[selected].append(reason)
    return {index: tuple(values) for index, values in sorted(reasons.items())}


def _fragment(geometries: dict[int, Any], signed_id_for_label: Callable[[int], int]) -> str:
    return "".join(
        '<path fill-rule="evenodd" '
        f'data-allen-id="{signed_id_for_label(label)}" '
        f'd="{html.escape(geometry_path(geometry), quote=True)}"/>'
        for label, geometry in sorted(geometries.items())
    )


def _encoded_sizes(fragment: str) -> dict[str, int | None]:
    raw = fragment.encode()
    try:
        import brotli
    except ImportError:
        brotli_size = None
    else:
        brotli_size = len(brotli.compress(raw, quality=11))
    return {
        "raw_utf8_bytes": len(raw),
        "gzip_9_bytes": len(gzip.compress(raw, compresslevel=9, mtime=0)),
        "brotli_11_bytes": brotli_size,
    }


def _intensity_payload(plane: np.ndarray) -> dict[str, Any]:
    values = np.asarray(plane, dtype=np.float64)
    finite = values[np.isfinite(values)]
    low, high = (
        (float(np.percentile(finite, 1)), float(np.percentile(finite, 99)))
        if finite.size
        else (0.0, 1.0)
    )
    if high <= low:
        high = low + 1
    normalized = np.clip((values - low) / (high - low), 0, 1)
    image = np.rint(normalized * 255).astype(np.uint8)
    return {
        "shape": list(image.shape),
        "dtype": "uint8",
        "encoding": "base64-raw-c-order",
        "data": base64.b64encode(image.tobytes(order="C")).decode(),
        "source_percentile_range": [low, high],
    }


def _strategy_variants(
    strategy_ids: Sequence[str], tolerances: Sequence[float]
) -> list[tuple[str, dict[str, Any]]]:
    variants: list[tuple[str, dict[str, Any]]] = []
    for strategy_id in strategy_ids:
        if strategy_id == "exact":
            variants.append((strategy_id, {}))
        elif strategy_id == "geos-coverage-simplify":
            for tolerance in tolerances:
                for simplify_boundary in (False, True):
                    variants.append(
                        (
                            strategy_id,
                            {
                                "tolerance_um": tolerance,
                                "simplify_boundary": simplify_boundary,
                            },
                        )
                    )
        else:
            variants.extend(
                (strategy_id, {"tolerance_um": tolerance}) for tolerance in tolerances
            )
    return variants


def _report_plane(
    *,
    projection: str,
    slice_index: int,
    world_coordinate_um: float,
    reasons: Sequence[str],
    plane: np.ndarray,
    intensity: np.ndarray,
    signed_id_for_label: Callable[[int], int],
    variants: Sequence[tuple[str, dict[str, Any]]],
    resolution_um: int,
    policy: EvaluationPolicy,
    view_box: Sequence[float],
) -> dict[str, Any]:
    results = []
    for strategy_id, parameters in variants:
        result = run_experiment(
            plane,
            strategy_id=strategy_id,
            parameters=parameters,
            resolution_um=resolution_um,
            policy=policy,
        )
        fragment = (
            _fragment(result.geometries_by_label, signed_id_for_label)
            if result.geometries_by_label is not None
            else None
        )
        record = result.deterministic_record()
        metrics = record.get("metrics")
        if metrics is not None:
            for region in metrics["regions"]:
                region["label"] = signed_id_for_label(region["label"])
            for key in (
                "worst_iou_region",
                "worst_absolute_area_change_region",
                "worst_relative_area_change_region",
            ):
                if metrics[key] is not None:
                    metrics[key] = signed_id_for_label(metrics[key])
        results.append(
            {
                **record,
                "svg_fragment": fragment,
                "encoded_sizes": _encoded_sizes(fragment) if fragment is not None else None,
            }
        )
    return {
        "projection": projection,
        "slice_index": slice_index,
        "world_coordinate_um": world_coordinate_um,
        "selection_reasons": list(reasons),
        "view_box": list(view_box),
        "source_plane_shape": list(plane.shape),
        "source_plane_dtype": str(plane.dtype),
        "source_plane_sha256": sha256_bytes(np.ascontiguousarray(plane).tobytes()),
        "intensity": _intensity_payload(intensity),
        "variants": results,
    }


def _read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_bytes())


def _verify_file(path: Path, descriptor: dict[str, Any], label: str) -> None:
    if not path.is_file():
        raise FileNotFoundError(f"missing {label}: {path}")
    if path.stat().st_size != descriptor["bytes"]:
        raise ValueError(f"{label} byte-size mismatch")
    if sha256_file(path) != descriptor["sha256"]:
        raise ValueError(f"{label} SHA-256 mismatch")


def _load_parent_slice(
    parent_root: Path, parent: dict[str, Any], projection: str, index: int
) -> dict[str, Any]:
    pack_sets = parent["projections"][projection]["pack_sets"]
    pack_set = pack_sets[sorted(pack_sets, key=int)[0]]
    descriptor = next(
        (
            item
            for item in pack_set["packs"]
            if item["first_slice_index"] <= index < item["first_slice_index"] + item["slice_count"]
        ),
        None,
    )
    if descriptor is None:
        raise ValueError(f"parent slice is undeclared: {projection}:{index}")
    encoded = (parent_root / descriptor["path"]).read_bytes()
    if len(encoded) != descriptor["bytes"] or sha256_bytes(encoded) != descriptor["sha256"]:
        raise ValueError(f"parent slice pack integrity mismatch: {descriptor['path']}")
    payload = json.loads(gzip.decompress(encoded))
    return next(item for item in payload["slices"] if item["slice_index"] == index)


def _regenerated_parent_paths(plane: np.ndarray, regions: Any) -> list[dict[str, Any]]:
    """Regenerate exact serialized paths without repeating full-corpus gates."""
    exact = raster_label_geometries(plane)
    return [
        {
            "atlas_ids": atlas_ids_for_row(regions, row),
            "fill_rule": "evenodd",
            "d": geometry_path_relative(exact[row]),
        }
        for row in sorted(exact)
    ]


def validate_real_sources(
    *,
    repository: Path,
    parent_root: Path,
    sampled_root: Path,
    annotation: Path,
    source_lut: Path,
    template_volume: Path,
    template_sha256: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    parent_path = parent_root / "manifest.json"
    sampled_path = sampled_root / "manifest.json"
    parent = _read_json(parent_path)
    sampled = _read_json(sampled_path)
    _validate_generated(parent_root, parent, repository)
    sampled_schema = _read_json(repository / "schema/anatomy-pack-v3/manifest.schema.json")
    Draft202012Validator(sampled_schema).validate(sampled)
    parent_sha = sha256_file(parent_path)
    if sampled["parent"]["pack_id"] != parent["pack_id"]:
        raise ValueError("sampled pack parent identity mismatch")
    if sampled["parent"]["manifest_sha256"] != parent_sha:
        raise ValueError("sampled pack parent manifest hash mismatch")
    _verify_file(annotation, parent["source"]["annotation"], "annotation")
    _verify_file(source_lut, parent["source"]["region_lut"], "bilateral region LUT")
    if not re.fullmatch(r"[0-9a-f]{64}", template_sha256):
        raise ValueError("template_sha256 must be lowercase SHA-256")
    if sha256_file(template_volume) != template_sha256:
        raise ValueError("average-template SHA-256 mismatch")
    return parent, sampled


def _git_provenance(repository: Path) -> dict[str, Any]:
    commit = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=repository, check=True, capture_output=True, text=True
    ).stdout.strip()
    dirty = bool(
        subprocess.run(
            ["git", "status", "--porcelain"], cwd=repository, check=True, capture_output=True, text=True
        ).stdout.strip()
    )
    return {"repository": "int-brain-lab/ephys-atlas-web-v2", "commit": commit, "dirty": dirty}


def build_synthetic_report(args: argparse.Namespace, repository: Path) -> dict[str, Any]:
    source_planes = synthetic_planes()
    ordered = list(source_planes.items())
    variants = _strategy_variants(args.strategies, args.tolerances_um)
    policy = EvaluationPolicy(
        args.maximum_error_um, args.minimum_iou, args.minimum_iou_area_mm2 * 1_000_000
    )
    planes = []
    for projection in PROJECTION_NAMES:
        explicit = getattr(args, f"{projection}_slices")
        candidates = range(len(ordered))
        selected = (
            {index: ("explicit CLI selection",) for index in explicit}
            if explicit
            else select_stress_samples(candidates, lambda index: ordered[index][1], int)
        )
        for index, reasons in selected.items():
            if not 0 <= index < len(ordered):
                raise ValueError(f"synthetic {projection} slice out of range: {index}")
            name, plane = ordered[index]
            planes.append(
                _report_plane(
                    projection=projection,
                    slice_index=index,
                    world_coordinate_um=float(index * 10),
                    reasons=(*reasons, f"synthetic case: {name}"),
                    plane=plane,
                    intensity=np.abs(plane),
                    signed_id_for_label=int,
                    variants=variants,
                    resolution_um=10,
                    policy=policy,
                    view_box=(-0.5, -0.5, plane.shape[1], plane.shape[0]),
                )
            )
    return _base_report(args, repository, policy, variants, planes, {
        "mode": "synthetic",
        "non_scientific": True,
        "identity": "deterministic synthetic topology fixtures",
        "region_metadata": {
            str(label): {"acronym": f"S{label}", "name": f"Synthetic region {label}"}
            for plane in source_planes.values()
            for label in sorted(int(value) for value in np.unique(plane) if value != 0)
        },
    })


def build_real_report(args: argparse.Namespace, repository: Path) -> dict[str, Any]:
    from iblatlas.atlas import AllenAtlas
    from iblatlas.regions import BrainRegions

    allowed_output = (repository / "artifacts/anatomy-smoothing-lab").resolve()
    resolved_output = args.output.resolve()
    if resolved_output != allowed_output and allowed_output not in resolved_output.parents:
        raise ValueError("real report output must stay under artifacts/anatomy-smoothing-lab")
    if not args.offline:
        raise ValueError("real report generation currently requires explicit --offline inputs")
    parent, sampled = validate_real_sources(
        repository=repository,
        parent_root=args.parent,
        sampled_root=args.sampled_pack,
        annotation=args.annotation,
        source_lut=args.source_lut,
        template_volume=args.template_volume,
        template_sha256=args.template_sha256,
    )
    label = np.load(args.source_lut, mmap_mode="r")
    if label.shape != LABEL_SHAPE or label.dtype != np.uint16:
        raise ValueError("bilateral region LUT shape/dtype mismatch")
    template = AllenAtlas._read_volume(args.template_volume)
    if template.shape != LABEL_SHAPE:
        raise ValueError("average-template grid shape mismatch")
    regions = BrainRegions()
    variants = _strategy_variants(args.strategies, args.tolerances_um)
    policy = EvaluationPolicy(
        args.maximum_error_um, args.minimum_iou, args.minimum_iou_area_mm2 * 1_000_000
    )
    planes = []
    for projection in PROJECTION_NAMES:
        projection_manifest = parent["projections"][projection]
        explicit = getattr(args, f"{projection}_slices")
        candidates = sampled["projections"][projection]["display_slice_indices"]
        plane_at = lambda index, name=projection: plane_for_projection(label, name, index)
        selected = (
            {index: ("explicit CLI selection",) for index in explicit}
            if explicit
            else select_stress_samples(
                candidates,
                plane_at,
                lambda row: int(regions.id[row]),
            )
        )
        for index, reasons in selected.items():
            if not 0 <= index < projection_manifest["slice_count"]:
                raise ValueError(f"{projection} slice out of range: {index}")
            plane = plane_at(index)
            regenerated_paths = _regenerated_parent_paths(plane, regions)
            parent_slice = _load_parent_slice(args.parent, parent, projection, index)
            if regenerated_paths != parent_slice["paths"]:
                raise ValueError(f"canonical exact-v2 mismatch: {projection}:{index}")
            intensity = plane_for_projection(template, projection, index)
            planes.append(
                _report_plane(
                    projection=projection,
                    slice_index=index,
                    world_coordinate_um=_projection_world_coordinate(projection_manifest, index),
                    reasons=reasons,
                    plane=plane,
                    intensity=intensity,
                    signed_id_for_label=lambda row: int(regions.id[row]),
                    variants=variants,
                    resolution_um=10,
                    policy=policy,
                    view_box=projection_manifest["view_box"],
                )
            )
    source = {
        "mode": "real",
        "non_scientific": False,
        "parent_pack_id": parent["pack_id"],
        "parent_manifest_sha256": sha256_file(args.parent / "manifest.json"),
        "sampled_pack_id": sampled["pack_id"],
        "annotation": parent["source"]["annotation"],
        "region_lut": parent["source"]["region_lut"],
        "average_template": {
            "path": args.template_volume.name,
            "bytes": args.template_volume.stat().st_size,
            "sha256": args.template_sha256,
            "source": args.template_source,
            "iblatlas_commit": IBLATLAS_COMMIT,
        },
        "region_metadata": {
            str(int(region_id)): {
                "acronym": str(regions.acronym[row]),
                "name": str(regions.name[row]),
            }
            for row, region_id in enumerate(regions.id)
            if int(region_id) != 0
        },
    }
    return _base_report(args, repository, policy, variants, planes, source)


def _base_report(
    args: argparse.Namespace,
    repository: Path,
    policy: EvaluationPolicy,
    variants: Sequence[tuple[str, dict[str, Any]]],
    planes: list[dict[str, Any]],
    source: dict[str, Any],
) -> dict[str, Any]:
    strategy_metadata = {
        item.strategy_id: {
            "label": item.label,
            "algorithm": item.algorithm,
            "version": item.version,
            "shared_edge_topology_expected": item.shared_edge_topology_expected,
            "unsafe_control": item.unsafe_control,
        }
        for item in available_strategies()
        if item.strategy_id in args.strategies
    }
    scientific_source = {
        key: value for key, value in source.items() if key != "region_metadata"
    }
    return {
        "format": FORMAT,
        "created_at": args.created_at,
        "source": scientific_source,
        "region_metadata": source["region_metadata"],
        "policy": {
            **asdict(policy),
            "status": "provisional experiment gates; not a production decision",
        },
        "strategies": strategy_metadata,
        "variant_count_per_plane": len(variants),
        "planes": planes,
        "provenance": {
            "generator": _git_provenance(repository),
            "shapely_version": shapely.__version__,
            "geos_version": shapely.geos_version_string,
            "iblatlas_commit": IBLATLAS_COMMIT,
        },
        "reproduction_command": _reproduction_command(args),
    }


def _reproduction_command(args: argparse.Namespace) -> str:
    common = (
        "python -m tools.anatomy_smoothing_lab.build --offline "
        f"--created-at {args.created_at} --strategies {','.join(args.strategies)} "
        f"--tolerances-um {','.join(format(value, 'g') for value in args.tolerances_um)} "
        f"--maximum-error-um {args.maximum_error_um:g} --minimum-iou {args.minimum_iou:g} "
        f"--minimum-iou-area-mm2 {args.minimum_iou_area_mm2:g}"
    )
    selections = "".join(
        f" --{projection}-slices {','.join(map(str, getattr(args, f'{projection}_slices')))}"
        for projection in PROJECTION_NAMES
        if getattr(args, f"{projection}_slices")
    )
    if args.synthetic:
        source = " --synthetic"
    else:
        source = (
            f" --source-lut {args.source_lut} --annotation {args.annotation}"
            f" --template-volume {args.template_volume}"
            f" --template-sha256 {args.template_sha256}"
            f" --template-source {args.template_source}"
            f" --parent {args.parent} --sampled-pack {args.sampled_pack}"
        )
    return common + source + selections + " --output <output.html>"


def render_report(report: dict[str, Any], template: str) -> bytes:
    marker = "__ANATOMY_SMOOTHING_LAB_DATA__"
    if template.count(marker) != 1:
        raise ValueError("report template must contain exactly one data marker")
    forbidden = re.compile(
        r"(?:https?://|<script[^>]+src\s*=|<link[^>]+href\s*=|@import|url\(\s*['\"]?https?:)",
        re.IGNORECASE,
    )
    audited_template = template.replace("http://www.w3.org/2000/svg", "")
    if forbidden.search(audited_template):
        raise ValueError("report template declares an external resource")
    payload = canonical_json(report).decode().replace("</", "<\\/")
    return template.replace(marker, payload).encode()


def write_report(report: dict[str, Any], template_path: Path, output: Path) -> None:
    rendered = render_report(report, template_path.read_text())
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(rendered)


def main(argv: Sequence[str] | None = None) -> None:
    args = parse_args(argv)
    repository = Path(__file__).resolve().parents[2]
    report = (
        build_synthetic_report(args, repository)
        if args.synthetic
        else build_real_report(args, repository)
    )
    write_report(report, args.template, args.output)
    counts = defaultdict(int)
    for plane in report["planes"]:
        for variant in plane["variants"]:
            counts[variant["eligibility"]] += 1
    print(
        f"wrote {args.output} with {len(report['planes'])} planes and "
        + ", ".join(f"{key}={value}" for key, value in sorted(counts.items()))
    )


if __name__ == "__main__":
    main()
