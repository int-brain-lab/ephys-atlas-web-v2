"""Deterministic physical-region distributions for schema-v1 volumes."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Mapping, Sequence

import numpy as np
import nrrd
from iblatlas.regions import BrainRegions

from .io import encoded_resource, json_resource, sha256_file, write_array, write_chunk, write_json

PARCELLATIONS = ("allen", "beryl", "cosmos")
HEMISPHERE_ENCODING = "signed-atlas-ids-negative-left"
REGIONAL_COUNT_LAYOUT = "underflow-bins-overflow"
IBLATLAS_COMMIT = "52083adf44825d0622a503705e095699a5957587"


@dataclass(frozen=True)
class PhysicalParcellation:
    """One mutually-exclusive signed mapping over an atlas label volume."""

    id: str
    region_ids: np.ndarray
    voxel_rows: np.ndarray
    metadata: tuple[dict, ...]


@dataclass(frozen=True)
class RegionalSelection:
    path: Path
    sha256: str
    parcellations: tuple[str, ...]
    iblatlas_commit: str
    agea_label_sha256: str
    agea_expected_rows: tuple[int, int, int]
    volume_annotation_sha256: str
    volume_annotation_source_axes: tuple[str, str, str]
    volume_annotation_transpose: tuple[int, int, int]
    volume_hemisphere_split_index: int
    volume_expected_rows: tuple[int, int, int]
    require_volume_complete_assignment: bool


def load_regional_selection(path: Path) -> RegionalSelection:
    path = path.resolve()
    try:
        document = json.loads(path.read_text())
        agea = document["agea"]
        volume = document["ephys_volumes"]
        axes = tuple(volume["annotation_source_axes"])
        transpose = tuple(volume["annotation_transpose_to_grid"])
        split_index = volume["hemisphere_split_index"]
        agea_audit = agea["mapping_audit"]
        volume_audit = volume["mapping_audit"]
    except (OSError, json.JSONDecodeError, KeyError, TypeError) as error:
        raise ValueError(f"volume regional-distribution selection is incomplete: {path}") from error
    if (
        document.get("format") != "ibl-volume-regional-distribution-selection-v1"
        or document.get("status") != "accepted"
        or document.get("decision") != "D078"
        or document.get("publication_authorized") is not False
    ):
        raise ValueError("volume regional-distribution selection is not the accepted D078 contract")
    parcellations = tuple(document.get("parcellations", ()))
    if parcellations != PARCELLATIONS:
        raise ValueError("D078 requires Allen, Beryl and Cosmos in canonical order")
    if agea.get("iblatlas_commit") != IBLATLAS_COMMIT:
        raise ValueError("D078 AGEA BrainRegions commit differs from the pinned builder dependency")
    if axes != ("ap", "dv", "ml") or transpose != (2, 0, 1):
        raise ValueError("D078 volume annotation orientation is unsupported")
    if (
        volume.get("hemisphere_axis") != "ml"
        or volume.get("left_index_rule") != "ml_index < hemisphere_split_index"
        or type(split_index) is not int
        or split_index < 1
    ):
        raise ValueError("D078 volume hemisphere split is unsupported")
    for digest in (agea.get("label_resource_sha256"), volume.get("annotation_sha256")):
        if not isinstance(digest, str) or len(digest) != 64:
            raise ValueError("D078 source hashes are invalid")
    return RegionalSelection(
        path=path,
        sha256=sha256_file(path),
        parcellations=parcellations,
        iblatlas_commit=agea["iblatlas_commit"],
        agea_label_sha256=agea["label_resource_sha256"],
        agea_expected_rows=tuple(
            int(agea_audit[f"{name}_lr_physical_rows"]) for name in PARCELLATIONS
        ),
        volume_annotation_sha256=volume["annotation_sha256"],
        volume_annotation_source_axes=axes,
        volume_annotation_transpose=transpose,
        volume_hemisphere_split_index=split_index,
        volume_expected_rows=tuple(
            int(volume_audit[f"{name}_lr_physical_rows"]) for name in PARCELLATIONS
        ),
        require_volume_complete_assignment=bool(volume["require_every_valid_voxel_assigned"]),
    )


def validate_parcellation_row_counts(
    parcellations: Mapping[str, PhysicalParcellation],
    expected_rows: Sequence[int],
) -> None:
    actual = tuple(len(parcellations[name].region_ids) for name in PARCELLATIONS)
    if actual != tuple(expected_rows):
        raise ValueError(
            f"physical parcellation rows {actual} differ from the D078 audit {tuple(expected_rows)}"
        )


def _brain_region_indices(
    labels: np.ndarray,
    semantics: Literal["brainregions-index", "allen-atlas-id"],
    regions: BrainRegions,
) -> tuple[np.ndarray, np.ndarray]:
    values = np.asarray(labels)
    if not np.issubdtype(values.dtype, np.integer):
        raise ValueError("atlas labels must use an integer dtype")
    flat = values.reshape(-1).astype(np.int64, copy=False)
    assigned = flat != 0
    indices = np.zeros(flat.shape, dtype=np.int64)
    if semantics == "brainregions-index":
        if np.any(flat < 0) or np.any(flat >= len(regions.id)):
            raise ValueError("BrainRegions-index labels are out of range")
        indices[:] = flat
        return indices, assigned
    if semantics != "allen-atlas-id":  # pragma: no cover - Literal guards callers
        raise ValueError(f"unsupported atlas-label semantics: {semantics}")
    id_to_index = {int(atlas_id): index for index, atlas_id in enumerate(regions.id)}
    unique_ids, inverse = np.unique(flat[assigned], return_inverse=True)
    unique_indices = np.empty(unique_ids.shape, dtype=np.int64)
    for position, atlas_id in enumerate(unique_ids):
        index = id_to_index.get(int(atlas_id))
        if index is None:
            raise ValueError(f"Allen annotation contains unknown atlas ID {atlas_id}")
        unique_indices[position] = index
    indices[assigned] = unique_indices[inverse]
    return indices, assigned


def build_physical_parcellations(
    labels: np.ndarray,
    *,
    semantics: Literal["brainregions-index", "allen-atlas-id"],
    ontology: BrainRegions | None = None,
    parcellations: Sequence[str] = PARCELLATIONS,
) -> dict[str, PhysicalParcellation]:
    """Map each nonzero label to exactly one signed physical mapping row."""
    regions = ontology or BrainRegions()
    source_indices, source_assigned = _brain_region_indices(labels, semantics, regions)
    result: dict[str, PhysicalParcellation] = {}
    for parcellation in parcellations:
        if parcellation not in PARCELLATIONS:
            raise ValueError(f"unsupported D078 parcellation: {parcellation}")
        mapping_name = f"{parcellation.capitalize()}-lr"
        target_indices = np.asarray(regions.mappings[mapping_name], dtype=np.int64)[source_indices]
        target_ids = np.asarray(regions.id, dtype=np.int64)[target_indices]
        mapped = source_assigned & (target_ids != 0)
        region_ids = np.unique(target_ids[mapped]).astype("<i4")
        if region_ids.size == 0:
            raise ValueError(f"{parcellation} has no assigned physical rows")
        voxel_rows = np.full(source_indices.shape, -1, dtype="<i4")
        voxel_rows[mapped] = np.searchsorted(region_ids, target_ids[mapped]).astype("<i4")
        voxel_rows = voxel_rows.reshape(np.asarray(labels).shape)
        id_to_index = {int(atlas_id): index for index, atlas_id in enumerate(regions.id)}
        metadata = []
        for row, atlas_id in enumerate(region_ids):
            region_index = id_to_index[int(atlas_id)]
            metadata.append(
                {
                    "index": row,
                    "atlas_id": int(atlas_id),
                    "acronym": str(regions.acronym[region_index]),
                    "name": str(regions.name[region_index]),
                    "mapping_member": True,
                }
            )
        result[parcellation] = PhysicalParcellation(
            id=parcellation,
            region_ids=region_ids,
            voxel_rows=voxel_rows,
            metadata=tuple(metadata),
        )
    return result


def load_lateralized_volume_annotation(
    path: Path,
    selection: RegionalSelection,
    expected_shape: Sequence[int],
) -> np.ndarray:
    """Load the pinned NRRD and apply D078's explicit axis and hemisphere rules."""
    path = path.resolve()
    if sha256_file(path) != selection.volume_annotation_sha256:
        raise ValueError("volume annotation SHA-256 differs from the D078 selection")
    annotation, _header = nrrd.read(path, index_order="F")
    annotation = np.transpose(annotation, selection.volume_annotation_transpose)
    if tuple(annotation.shape) != tuple(expected_shape):
        raise ValueError("D078 volume annotation shape differs from the feature grid")
    split = selection.volume_hemisphere_split_index
    if split >= annotation.shape[0]:
        raise ValueError("D078 hemisphere split lies outside the volume grid")
    lateralized = np.asarray(annotation, dtype="<i4").copy()
    lateralized[:split] *= -1
    return lateralized


def write_physical_parcellations(
    release_dir: Path,
    parcellations: Mapping[str, PhysicalParcellation],
) -> list[dict]:
    descriptors = []
    for parcellation_id in PARCELLATIONS:
        parcellation = parcellations[parcellation_id]
        root = release_dir / "parcellations" / parcellation_id
        index = write_array(
            root / "region_ids.i32",
            parcellation.region_ids,
            "int32",
            root=release_dir,
        )
        metadata_path = root / "regions.json"
        write_json(metadata_path, list(parcellation.metadata))
        descriptors.append(
            {
                "id": parcellation_id,
                "region_index": index,
                "metadata": json_resource(
                    metadata_path,
                    release_dir,
                    "ephys-atlas-region-metadata-v1",
                ),
            }
        )
    return descriptors


def _regional_histogram_counts(
    values: np.ndarray,
    rows: np.ndarray,
    row_count: int,
    edges: np.ndarray,
) -> np.ndarray:
    bin_count = len(edges) - 1
    columns = np.searchsorted(edges, values, side="right")
    columns[values == edges[-1]] = bin_count
    counts = np.zeros((row_count, bin_count + 2), dtype="<u4")
    np.add.at(counts, (rows, columns), 1)
    return counts


def write_volume_regional_distributions(
    summary_root: Path,
    values: np.ndarray,
    valid: np.ndarray,
    global_binnings: Sequence[dict],
    parcellations: Mapping[str, PhysicalParcellation],
    *,
    require_complete_assignment: bool,
) -> list[dict]:
    """Write exact-edge matrices relative to a volume summary directory."""
    volume = np.asarray(values)
    valid_mask = np.asarray(valid, dtype=bool)
    if volume.shape != valid_mask.shape:
        raise ValueError("volume values and validity mask differ in shape")
    companions = []
    for parcellation_id in PARCELLATIONS:
        parcellation = parcellations[parcellation_id]
        if parcellation.voxel_rows.shape != volume.shape:
            raise ValueError(f"{parcellation_id} atlas labels differ from the volume grid")
        assigned_mask = valid_mask & (parcellation.voxel_rows >= 0)
        assigned = int(assigned_mask.sum())
        unassigned = int(valid_mask.sum()) - assigned
        if require_complete_assignment and unassigned:
            raise ValueError(
                f"{parcellation_id} leaves {unassigned} valid voxels unassigned"
            )
        assigned_values = np.asarray(volume[assigned_mask], dtype=np.float64)
        assigned_rows = np.asarray(parcellation.voxel_rows[assigned_mask], dtype=np.intp)
        resources = []
        for binning in global_binnings:
            edges = np.asarray(binning["edges"], dtype=np.float64)
            counts = _regional_histogram_counts(
                assigned_values,
                assigned_rows,
                len(parcellation.region_ids),
                edges,
            )
            path = summary_root / "regional" / f"{parcellation_id}.{binning['id']}.u32.gz"
            write_chunk(path, counts, "uint32", "gzip", level=6)
            resources.append(
                {
                    "binning_id": binning["id"],
                    "regional_counts": {
                        "format": "raw-binary-array-v1",
                        "resource": encoded_resource(
                            path,
                            summary_root,
                            "application/octet-stream",
                            codec="gzip",
                            decoded_bytes=counts.nbytes,
                            level=6,
                        ),
                        "dtype": "uint32",
                        "shape": list(counts.shape),
                        "order": "C",
                        "endianness": "little",
                    },
                    "regional_count_layout": REGIONAL_COUNT_LAYOUT,
                }
            )
        companions.append(
            {
                "parcellation_id": parcellation_id,
                "hemisphere_encoding": HEMISPHERE_ENCODING,
                "assigned_valid_voxel_count": assigned,
                "unassigned_valid_voxel_count": unassigned,
                "binnings": resources,
            }
        )
    return companions
