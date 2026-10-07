"""Build deterministic interior navigation anchors from pinned native anatomy.

This adds a companion asset; it never edits or regenerates projection geometry.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import tempfile
from typing import Any

import numpy as np

from ephys_atlas_builder.build_environment import build_environment
from ephys_atlas_builder.schema_v1 import validate_schema_v1_document
from tools.projection_pack.build import _canonical, _read_resource, validate_projection_pack
from tools.svg_pack import decode

MAPPINGS = ("allen", "beryl", "cosmos")
AXES = ("coronal", "sagittal", "horizontal")
RECIPE = "nearest-interior-centroid-displayed-crosshair-v1"


def sha_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while block := stream.read(8 * 1024 * 1024):
            digest.update(block)
    return digest.hexdigest()


def nearest_indices(inventory: list[int], size: int) -> np.ndarray:
    """Native-to-display snapping, with the browser's lower-index tie rule."""
    values = np.asarray(inventory, dtype=np.int32)
    if not len(values) or np.any(np.diff(values) <= 0) or values[0] < 0 or values[-1] >= size:
        raise ValueError("invalid display inventory")
    query = np.arange(size)
    right = np.minimum(np.searchsorted(values, query), len(values) - 1)
    left = np.maximum(right - 1, 0)
    return np.where(query - values[left] <= values[right] - query, values[left], values[right])


def read_display_presence(root: Path, manifest: dict[str, Any]) -> dict[str, dict[str, dict[int, set[int]]]]:
    result = {mapping: {axis: {} for axis in AXES} for mapping in MAPPINGS}
    pattern = re.compile(r'data-(allen|beryl|cosmos)-id="(-?\d+)"')
    for projection in manifest["projections"]:
        axis = projection["id"]
        if axis not in AXES:
            continue
        _, raw = _read_resource(root, projection["resource_index"]["resource"])
        index = json.loads(raw)
        for entry in index["resources"]:
            _, raw = _read_resource(root, entry["resource"])
            pack = decode(raw)
            for fragment in pack.fragments:
                for mapping in MAPPINGS:
                    result[mapping][axis][fragment.slice_index] = set()
                for mapping, region_id in pattern.findall(fragment.svg):
                    result[mapping][axis][fragment.slice_index].add(int(region_id))
    return result


def compute_anchors(
    label: np.ndarray,
    lookup: dict[str, np.ndarray],
    inventories: dict[str, list[int]],
    presence: dict[str, dict[str, dict[int, set[int]]]],
    *,
    progress: bool = False,
) -> tuple[dict[str, np.ndarray], dict[str, Any]]:
    """Closest occupied voxel to each signed region centroid, with display gates.

    Moments are computed once per native LUT row. A second bounded AP-plane pass
    considers only voxels whose three snapped display crosshairs still belong to
    that same mapped region. Ties resolve lexicographically in AP/ML/DV order.
    """
    if label.ndim != 3 or label.dtype != np.uint16 or set(lookup) != set(MAPPINGS):
        raise ValueError("expected uint16 AP/ML/DV labels and all three mappings")
    row_count = len(lookup["allen"])
    if any(len(value) != row_count or value[0] != 0 for value in lookup.values()):
        raise ValueError("mapping LUTs must share native rows and zero background")
    shape = label.shape
    native_count = np.zeros(row_count, dtype=np.int64)
    native_sum = np.zeros((row_count, 3), dtype=np.float64)
    for ap in range(shape[0]):
        plane = label[ap]
        if np.max(plane) >= row_count:
            raise ValueError("native label is absent from pinned region catalog")
        ml, dv = np.nonzero(plane)
        rows = plane[ml, dv]
        counts = np.bincount(rows, minlength=row_count)
        native_count += counts
        native_sum[:, 0] += counts * ap
        native_sum[:, 1] += np.bincount(rows, weights=ml, minlength=row_count)
        native_sum[:, 2] += np.bincount(rows, weights=dv, minlength=row_count)
        if progress and ap % 160 == 0:
            print(f"Native moments: {ap}/{shape[0]}", flush=True)

    snapped = {axis: nearest_indices(inventories[axis], shape[i]) for i, axis in enumerate(AXES)}
    state = {}
    for mapping in MAPPINGS:
        ids, slots = np.unique(lookup[mapping], return_inverse=True)
        counts = np.zeros(len(ids), dtype=np.int64)
        sums = np.zeros((len(ids), 3))
        np.add.at(counts, slots, native_count)
        np.add.at(sums, slots, native_sum)
        centers = np.divide(sums, counts[:, None], out=np.zeros_like(sums), where=counts[:, None] > 0)
        allowed = {}
        for i, axis in enumerate(AXES):
            visible = np.zeros((len(ids), shape[i]), dtype=bool)
            for slot, region_id in enumerate(ids):
                visible[slot] = [int(region_id) in presence[mapping][axis][int(index)] for index in snapped[axis]]
            allowed[axis] = visible
        state[mapping] = dict(ids=ids, slots=slots, centers=centers, counts=counts, allowed=allowed,
                              best_distance=np.full(len(ids), np.inf), best_flat=np.full(len(ids), np.iinfo(np.int64).max, dtype=np.int64))

    for ap in range(shape[0]):
        plane = label[ap]
        ml, dv = np.nonzero(plane)
        rows = plane[ml, dv]
        flat = (ap * shape[1] + ml) * shape[2] + dv
        for mapping, data in state.items():
            ids = lookup[mapping][rows]
            slots = data["slots"][rows]
            allowed = data["allowed"]
            eligible = (allowed["coronal"][slots, ap]
                        & allowed["sagittal"][slots, ml]
                        & allowed["horizontal"][slots, dv])
            eligible &= lookup[mapping][label[snapped["coronal"][ap], ml, dv]] == ids
            eligible &= lookup[mapping][plane[snapped["sagittal"][ml], dv]] == ids
            eligible &= lookup[mapping][plane[ml, snapped["horizontal"][dv]]] == ids
            chosen = slots[eligible]
            if not len(chosen):
                continue
            center = data["centers"][chosen]
            distances = (ap - center[:, 0]) ** 2 + (ml[eligible] - center[:, 1]) ** 2 + (dv[eligible] - center[:, 2]) ** 2
            local_distance = np.full(len(data["ids"]), np.inf)
            np.minimum.at(local_distance, chosen, distances)
            tied = distances == local_distance[chosen]
            local_flat = np.full(len(data["ids"]), np.iinfo(np.int64).max, dtype=np.int64)
            np.minimum.at(local_flat, chosen[tied], flat[eligible][tied])
            improve = ((local_distance < data["best_distance"])
                       | ((local_distance == data["best_distance"]) & (local_flat < data["best_flat"])))
            data["best_distance"][improve] = local_distance[improve]
            data["best_flat"][improve] = local_flat[improve]
        if progress and ap % 160 == 0:
            print(f"Interior/display gates: {ap}/{shape[0]}", flush=True)

    result = {}
    audit = {}
    for mapping, data in state.items():
        ids = data["ids"]
        output = np.full((len(ids), 4), -1, dtype="<i4")
        output[:, 0] = ids
        available = np.isfinite(data["best_distance"])
        points = np.column_stack(np.unravel_index(data["best_flat"][available], shape))
        output[available, 1:] = points
        output = output[ids != 0]
        result[mapping] = output
        audit[mapping] = dict(rows=len(output), anchored=int(np.sum(available & (ids != 0))),
                              no_native_voxels=int(np.sum((data["counts"] == 0) & (ids != 0))),
                              no_display_anchor=int(np.sum((data["counts"] > 0) & ~available & (ids != 0))))
    return result, audit


def build_navigation(
    *, label_path: Path, parent_manifest: Path, projection_root: Path, regions_path: Path, output: Path,
) -> dict[str, Any]:
    if output.exists():
        raise ValueError("refusing to overwrite navigation asset")
    parent_raw = parent_manifest.read_bytes()
    parent = json.loads(parent_raw)
    source = parent["source"]["region_lut"]
    if label_path.stat().st_size != source["bytes"] or sha_file(label_path) != source["sha256"]:
        raise ValueError("native label LUT differs from pinned anatomy parent")
    projections = validate_projection_pack(projection_root)
    projection_raw = (projection_root / "manifest.json").read_bytes()
    coronal = next(p for p in projections["projections"] if p["id"] == "coronal")
    regions_raw = regions_path.read_bytes()
    catalog = json.loads(regions_raw)
    if catalog["reference_space_id"] != projections["reference_space_id"]:
        raise ValueError("region catalog reference space differs from projection pack")
    # Mapping behavior is pinned by the same signed physical BrainRegions rows
    # used for the exact parent geometry, including folded unassigned IDs.
    rows = catalog["mappings"]["allen"]
    lookup = {mapping: np.zeros(max(row["idx"] for row in rows) + 1, dtype=np.int32) for mapping in MAPPINGS}
    for row in rows:
        sign = -1 if row["atlas_id"] < 0 else 1
        for mapping in MAPPINGS:
            lookup[mapping][row["idx"]] = sign * abs(row["mapped_atlas_ids"][mapping])
    label = np.load(label_path, mmap_mode="r")
    shape = [coronal["slice_count"], *coronal["slice_shape"]]
    if list(label.shape) != shape or coronal["plane_index_to_world_um"] != parent["projections"]["coronal"]["plane_index_to_world_um"]:
        raise ValueError("projection pack and native parent grids differ")
    inventories = {p["id"]: p["display_slices"] for p in projections["projections"] if p["id"] in AXES}
    arrays, audit = compute_anchors(label, lookup, inventories, read_display_presence(projection_root, projections), progress=True)
    script_sha = sha_file(Path(__file__))
    identity = hashlib.sha256(_canonical({"recipe": RECIPE, "label": source["sha256"],
                                        "projection": hashlib.sha256(projection_raw).hexdigest(),
                                        "regions": hashlib.sha256(regions_raw).hexdigest(), "generator": script_sha})).hexdigest()
    output.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix=".navigation-", dir=output.parent))
    try:
        mappings = {}
        for mapping, array in arrays.items():
            raw = array.tobytes(order="C")
            (stage / f"{mapping}.bin").write_bytes(raw)
            mappings[mapping] = dict(format="raw-binary-array-v1", dtype="int32", shape=list(array.shape), order="C", endianness="little",
                                    resource=dict(path=f"{mapping}.bin", media_type="application/octet-stream", bytes=len(raw), sha256=hashlib.sha256(raw).hexdigest(),
                                                  codec=dict(name="none", decoded_bytes=len(raw))))
        manifest = dict(schema_version="1.0", format="atlas-region-navigation-v1", navigation_id=f"native-interior-{identity[:16]}", immutable=True,
                        reference_space_id=projections["reference_space_id"],
                        projection_pack=dict(pack_id=projections["pack_id"], manifest_sha256=hashlib.sha256(projection_raw).hexdigest()),
                        grid=dict(grid_id=coronal["grid_id"], shape=shape, storage_axes=["ap", "ml", "dv"], index_to_world_um=coronal["plane_index_to_world_um"]),
                        mappings=mappings,
                        provenance=dict(sources=[dict(role="atlas-geometry", description="Pinned bilateral native 10 um LUT", path=source["path"], sha256=source["sha256"]),
                                                 dict(role="atlas-geometry", description="Validated immutable parent manifest", path=parent_manifest.name, sha256=hashlib.sha256(parent_raw).hexdigest()),
                                                 dict(role="atlas-geometry", description="Pinned projection pack", release=projections["pack_id"], sha256=hashlib.sha256(projection_raw).hexdigest()),
                                                 dict(role="atlas-geometry", description="Pinned signed region mappings", path="regions.json", sha256=hashlib.sha256(regions_raw).hexdigest()),
                                                 dict(role="scientific-code", description="Exact navigation generator source", path="tools/projection_pack/build_region_navigation.py", sha256=script_sha)],
                                        builder=dict(name="atlas-region-navigation", version=script_sha, command="uv run --project builder --extra anatomy --extra scientific --extra test --locked python -m tools.projection_pack.build_region_navigation", environment=build_environment()),
                                        recipe=dict(id=RECIPE, centroid_population="all occupied native voxels of each signed mapped region", tie_break="AP then ML then DV", coverage=audit),
                                        notes=["Navigation presentation aid; does not change anatomy, scientific feature data or geometry."]))
        validate_schema_v1_document(manifest, "region-navigation.schema.json")
        (stage / "manifest.json").write_bytes(_canonical(manifest))
        bindings = "import manifestRaw from './manifest.json?raw';\n" + "\n".join(f"import {m}Url from './{m}.bin?url';" for m in MAPPINGS)
        bindings += "\n\n/** Generated by tools/projection_pack/build_region_navigation.py. */\nexport const REGION_NAVIGATION_ASSETS = {\n  manifest: JSON.parse(manifestRaw) as unknown,\n  resources: { allen: allenUrl, beryl: berylUrl, cosmos: cosmosUrl },\n};\n"
        (stage / "bindings.ts").write_text(bindings)
        shutil.move(stage, output)
        print(json.dumps(audit), flush=True)
        return manifest
    finally:
        if stage.exists():
            shutil.rmtree(stage)


def validate_deployment_inputs(projection_root: Path, regions_path: Path, config: dict) -> None:
    """Bind generation to the exact served bytes selected for deployment."""
    for role, path in (("projection", projection_root / "manifest.json"), ("atlas_regions", regions_path)):
        raw = path.read_bytes()
        descriptor = config[role]
        if len(raw) != descriptor["bytes"] or hashlib.sha256(raw).hexdigest() != descriptor["sha256"]:
            raise ValueError(f"navigation generation {role} differs from deployment descriptor")


def main() -> None:
    from iblatlas.atlas import AllenAtlas
    root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--label", type=Path, default=Path(AllenAtlas._get_cache_dir()) / "annotation_10_lut_bilateral_v02.npy")
    parser.add_argument("--parent-manifest", type=Path, default=root / "web/public/atlas/anatomy/allen-ccfv3-10um-bilateral-exact-599b5e0bbab1/manifest.json")
    parser.add_argument("--projection-root", type=Path, required=True,
                        help="Explicit verified target pack; never defaults to development geometry")
    parser.add_argument("--site-config", type=Path,
                        help="Require the target projection and signed mappings to match this deployment config")
    parser.add_argument("--regions", type=Path, default=root / "web/public/atlas/allen-ccf-2017/regions.json")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.site_config:
        config = json.loads(args.site_config.read_bytes())
        validate_deployment_inputs(args.projection_root, args.regions, config)
    build_navigation(label_path=args.label, parent_manifest=args.parent_manifest, projection_root=args.projection_root, regions_path=args.regions, output=args.output)


if __name__ == "__main__":
    main()
