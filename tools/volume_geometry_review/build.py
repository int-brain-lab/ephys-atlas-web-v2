from __future__ import annotations

import argparse
import base64
import hashlib
import json
import subprocess
from itertools import product
from pathlib import Path
from typing import Any

import numpy as np

from ephys_atlas_builder.io import canonical_json, sha256_file, write_json
from ephys_atlas_builder.npz import extract_last_axis_nonzero_mask


SCHEMA = "ibl-volume-geometry-review-v1"
IBLATLAS_COMMIT = "52083adf44825d0622a503705e095699a5957587"
AXIS_NAMES = ("ml", "ap", "dv")


def _overlap(reference: np.ndarray, candidate: np.ndarray) -> dict[str, float | int]:
    intersection = int(np.logical_and(reference, candidate).sum())
    union = int(np.logical_or(reference, candidate).sum())
    reference_count = int(reference.sum())
    candidate_count = int(candidate.sum())
    return {
        "reference_count": reference_count,
        "candidate_count": candidate_count,
        "intersection": intersection,
        "union": union,
        "dice": 1.0 if reference_count + candidate_count == 0 else 2 * intersection / (reference_count + candidate_count),
        "iou": 1.0 if union == 0 else intersection / union,
        "reference_coverage": 1.0 if reference_count == 0 else intersection / reference_count,
        "candidate_precision": 1.0 if candidate_count == 0 else intersection / candidate_count,
    }


def _slice_iou(reference: np.ndarray, candidate: np.ndarray, axis: int) -> list[float | None]:
    output = []
    for index in range(reference.shape[axis]):
        ref = np.take(reference, index, axis=axis)
        cand = np.take(candidate, index, axis=axis)
        union = int(np.logical_or(ref, cand).sum())
        output.append(None if union == 0 else float(np.logical_and(ref, cand).sum() / union))
    return output


def _affine(
    shape: tuple[int, int, int],
    origin_um: tuple[float, float, float],
    step_um: tuple[float, float, float],
    reverse: tuple[bool, bool, bool],
    edge_shifted: bool,
) -> list[float]:
    matrix = np.eye(4, dtype=np.float64)
    matrix[:3, :3] = 0
    for axis in range(3):
        slope = -step_um[axis] if reverse[axis] else step_um[axis]
        start = (
            origin_um[axis] + step_um[axis] * (shape[axis] - 1)
            if reverse[axis]
            else origin_um[axis]
        )
        if edge_shifted:
            start += slope / 2
        matrix[axis, axis] = slope
        matrix[axis, 3] = start
    return [float(value) for value in matrix.reshape(-1)]


def _packed(mask: np.ndarray) -> str:
    payload = np.packbits(mask.reshape(-1), bitorder="little").tobytes()
    return base64.b64encode(payload).decode()


def build_review_report(
    source_mask: np.ndarray,
    atlas_mask_xyz: np.ndarray,
    *,
    origin_um: tuple[float, float, float],
    step_um: tuple[float, float, float],
    provenance: dict[str, Any],
) -> dict[str, Any]:
    source_mask = np.asarray(source_mask, dtype=bool)
    atlas_mask_xyz = np.asarray(atlas_mask_xyz, dtype=bool)
    if source_mask.ndim != 3 or source_mask.shape != atlas_mask_xyz.shape:
        raise ValueError("source and atlas XYZ masks must have the same 3-D shape")
    shape = tuple(int(value) for value in source_mask.shape)
    candidates = []
    for reverse in product((False, True), repeat=3):
        transformed = source_mask
        for axis, reversed_axis in enumerate(reverse):
            if reversed_axis:
                transformed = np.flip(transformed, axis=axis)
        directions = tuple("reverse" if value else "forward" for value in reverse)
        identifier = "_".join(
            f"{axis}-{direction}" for axis, direction in zip(AXIS_NAMES, directions, strict=True)
        )
        metrics = _overlap(atlas_mask_xyz, transformed)
        candidates.append({
            "id": identifier,
            "directions": dict(zip(AXIS_NAMES, directions, strict=True)),
            "reverse": list(reverse),
            "metrics": metrics,
            "slice_iou": {
                axis: _slice_iou(atlas_mask_xyz, transformed, index)
                for index, axis in enumerate(AXIS_NAMES)
            },
            "index_to_world_um": {
                "voxel_centers": _affine(shape, origin_um, step_um, reverse, False),
                "edge_shifted": _affine(shape, origin_um, step_um, reverse, True),
            },
        })
    candidates.sort(key=lambda item: (-item["metrics"]["dice"], item["id"]))
    identity = {
        "schema": SCHEMA,
        "shape_xyz": list(shape),
        "origin_um": list(origin_um),
        "step_um": list(step_um),
        "volume_sha256": provenance["volume"]["sha256"],
        "annotation_sha256": provenance["annotation"]["sha256"],
    }
    return {
        "schema": SCHEMA,
        "review_id": hashlib.sha256(canonical_json(identity)).hexdigest(),
        "status": "frozen visual-review evidence; D043 selects the exact W26 affine",
        "shape_xyz": list(shape),
        "axis_order": list(AXIS_NAMES),
        "atlas_origin_um": list(origin_um),
        "atlas_step_um": list(step_um),
        "source_mask": _packed(source_mask),
        "atlas_mask": _packed(atlas_mask_xyz),
        "candidate_count": len(candidates),
        "candidates": candidates,
        "provenance": provenance,
        "limitations": [
            "The 228×264×160 source extent uniquely matches Allen ML×AP×DV at 50 µm; arbitrary scaling and translation are excluded.",
            "Mask overlap can rank forward/reverse index directions but cannot by itself prove scientific handedness.",
            "The edge-shifted convention is displayed at half-voxel offset and shares discrete voxel-overlap metrics with its center candidate.",
            "A bilateral or near-symmetric mask may leave ML reversal visually ambiguous.",
            "Exporting a selection does not change production configuration or supersede D043.",
        ],
    }


def _git_state(repository: Path) -> dict[str, Any]:
    commit = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=repository, check=True, capture_output=True, text=True
    ).stdout.strip()
    dirty = bool(subprocess.run(
        ["git", "status", "--porcelain"], cwd=repository, check=True, capture_output=True, text=True
    ).stdout.strip())
    return {"repository": "rossant/ibl-ephys-atlas-web-v2", "commit": commit, "dirty": dirty}


def _read_scalar_metadata(volume: Path) -> tuple[int, tuple[int, int, int]]:
    with np.load(volume, allow_pickle=True) as source:
        resolution_um = int(np.asarray(source["res_um"]).reshape(-1)[0])
        grid_shape = tuple(int(value) for value in np.asarray(source["grid_shape"]).reshape(-1))
    return resolution_um, grid_shape


def build(args: argparse.Namespace) -> Path:
    repository = Path(__file__).resolve().parents[2]
    allowed = (repository / "artifacts/volume-geometry-review").resolve()
    output = args.output.resolve()
    if output != allowed and allowed not in output.parents:
        raise ValueError("review output must stay under artifacts/volume-geometry-review")
    if sha256_file(args.volume) != args.volume_sha256:
        raise ValueError("encoding-volume SHA-256 mismatch")
    if sha256_file(args.annotation) != args.annotation_sha256:
        raise ValueError("Allen annotation SHA-256 mismatch")

    resolution_um, grid_shape = _read_scalar_metadata(args.volume)
    if resolution_um != 50:
        raise ValueError(f"review requires the pinned 50 µm volume, got {resolution_um}")
    output.mkdir(parents=True, exist_ok=True)
    mask_path = output / "w26-nonzero-mask.npy"
    mask_report = extract_last_axis_nonzero_mask(args.volume, mask_path)
    public_mask_report = {
        key: value
        for key, value in mask_report.items()
        if key not in {"source", "output"}
    }
    source_mask = np.load(mask_path, mmap_mode="r")
    if tuple(source_mask.shape) != grid_shape:
        raise ValueError("extracted mask shape does not match declared grid_shape")

    try:
        from iblatlas.atlas import AllenAtlas, ALLEN_CCF_LANDMARKS_MLAPDV_UM
    except ImportError as exc:
        raise RuntimeError("volume geometry review requires pinned iblatlas") from exc
    annotation = AllenAtlas._read_volume(args.annotation)
    expected_storage_shape = (grid_shape[1], grid_shape[0], grid_shape[2])
    if tuple(annotation.shape) != expected_storage_shape:
        raise ValueError(
            f"Allen AP×ML×DV annotation shape {annotation.shape} does not match {expected_storage_shape}"
        )
    atlas_mask_xyz = np.transpose(annotation != 0, (1, 0, 2))
    bregma = np.asarray(ALLEN_CCF_LANDMARKS_MLAPDV_UM["bregma"], dtype=np.float64)
    step_um = (50.0, -50.0, -50.0)
    origin_um = tuple(float(value) for value in (-bregma * np.sign(step_um)))
    provenance = {
        "created_at": args.created_at,
        "volume": {
            "path": args.volume.name,
            "bytes": args.volume.stat().st_size,
            "sha256": args.volume_sha256,
            "mask": public_mask_report,
        },
        "annotation": {
            "path": args.annotation.name,
            "bytes": args.annotation.stat().st_size,
            "sha256": args.annotation_sha256,
            "storage_axis_order": ["ap", "ml", "dv"],
        },
        "iblatlas": {"repository": "int-brain-lab/iblatlas", "commit": IBLATLAS_COMMIT},
        "generator": _git_state(repository),
    }
    report = build_review_report(
        source_mask,
        atlas_mask_xyz,
        origin_um=origin_um,
        step_um=step_um,
        provenance=provenance,
    )
    write_json(output / "review.json", {
        key: value for key, value in report.items() if key not in {"source_mask", "atlas_mask"}
    })
    template = (Path(__file__).parent / "template.html").read_text()
    payload = json.dumps(report, sort_keys=True, separators=(",", ":")).replace("</", "<\\/")
    (output / "index.html").write_text(
        template.replace("__VOLUME_GEOMETRY_REVIEW_DATA__", payload)
    )
    return output / "index.html"


def parser() -> argparse.ArgumentParser:
    command = argparse.ArgumentParser()
    command.add_argument("--volume", type=Path, required=True)
    command.add_argument("--volume-sha256", required=True)
    command.add_argument("--annotation", type=Path, required=True)
    command.add_argument("--annotation-sha256", required=True)
    command.add_argument("--created-at", required=True)
    command.add_argument("--output", type=Path, default=Path("artifacts/volume-geometry-review"))
    return command


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    print(build(args))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
