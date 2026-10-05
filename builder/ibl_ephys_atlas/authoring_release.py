"""Serialize a validated authoring model as a schema-v1 release graph."""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING, Any

import numpy as np

from ephys_atlas_builder.io import json_resource, write_json
from ephys_atlas_builder.regional_release import (
    linear_full_display,
    write_feature_parcellation,
    write_parcellation,
)

from ._version import _authoring_version
from .volume import write_volume_representation

if TYPE_CHECKING:
    from .model import Dataset


def build_release(dataset: Dataset, release_dir: Path) -> Path:
    dataset.validate().raise_for_errors()
    observations = [
        feature._regional
        for feature in dataset.features
        if feature._regional is not None
    ]
    volumes = [
        feature._volume
        for feature in dataset.features
        if feature._volume is not None
    ]
    mapping_order = tuple(
        mapping
        for mapping in ("Allen", "Beryl", "Cosmos")
        if any(mapping in item.output_mappings for item in observations)
    )
    parcellations = []
    ordered_ids_by_mapping: dict[str, list[int]] = {}
    for mapping in mapping_order:
        union = sorted(
            {
                int(region_id)
                for item in observations
                if mapping in item.output_mappings
                for region_id in item.region_ids_by_mapping[mapping]
            }
        )
        metadata = {}
        for item in observations:
            if mapping not in item.output_mappings:
                continue
            for region_id, info in item.metadata_by_mapping[mapping].items():
                previous = metadata.get(region_id)
                if previous is not None and previous != info:
                    raise ValueError(
                        f"inconsistent iblatlas metadata for {mapping} ID {region_id}"
                    )
                metadata[region_id] = info
        parcellation, _ = write_parcellation(
            release_dir,
            mapping.lower(),
            np.asarray(union, dtype=np.int32),
            metadata,
        )
        parcellations.append(parcellation)
        # write_parcellation folds positive IDs and sorts their negatives,
        # so feature rows follow descending positive logical IDs.
        ordered_ids_by_mapping[mapping] = sorted(union, reverse=True)

    feature_refs = []
    for feature in sorted(dataset.features, key=lambda item: item.id):
        item = feature._regional
        display = linear_full_display()
        feature_root = release_dir / "features" / feature.id
        display_document: dict[str, Any] = {}
        representation_document: dict[str, Any] = {}
        if item is not None:
            representations = [
                write_feature_parcellation(
                    feature_root,
                    mapping.lower(),
                    item.values,
                    item.groups_for(ordered_ids_by_mapping[mapping], mapping),
                    dataset.histogram_bins,
                    feature.semantics.source_population,
                    distribution_display=display,
                )
                for mapping in item.output_mappings
            ]
            display_document["regional"] = display
            representation_document["regional"] = {
                "format": "ephys-atlas-regional-v1",
                "parcellations": representations,
            }
        if feature._volume is not None:
            volume_document, volume_display = write_volume_representation(
                feature_root, feature._volume, dataset.histogram_bins
            )
            display_document["volume"] = volume_display
            representation_document["volume"] = volume_document
        document = {
            "schema_version": "1.0",
            "id": feature.id,
            "label": feature.label,
            "description": feature.description,
            "unit": feature.unit,
            "display": display_document,
            "value_semantics": feature.semantics.to_document(),
            "representations": representation_document,
            "artifacts": [],
        }
        feature_path = feature_root / "feature.json"
        write_json(feature_path, document)
        feature_refs.append(
            {
                "id": feature.id,
                "descriptor": json_resource(
                    feature_path, release_dir, "ephys-atlas-feature-v1"
                ),
            }
        )

    iblatlas_versions = sorted({item.iblatlas_version for item in observations})
    source_documents = [source.to_document() for source in dataset.sources]
    source_documents.extend(
        {
            "role": "scientific-code",
            "description": "iblatlas BrainRegions Allen ontology authority",
            "release": release,
        }
        for release in iblatlas_versions
    )
    if volumes:
        source_documents.extend(
            {
                "role": "atlas-geometry",
                "description": (
                    "iblatlas AllenAtlas BrainCoordinates geometry authority; "
                    f"{grid.resolution_um} um with array axes {','.join(grid.array_axes)}"
                ),
                "release": (
                    f"iblatlas {grid.iblatlas_version}; Allen CCF 2017; "
                    f"{grid.grid_id}"
                ),
            }
            for grid in sorted(
                {item.grid for item in volumes},
                key=lambda value: (value.grid_id, value.array_axes),
            )
        )

    if not volumes:
        recipe: dict[str, Any] = {
            "id": "ibl-ephys-atlas-regional-authoring-v1",
            "source_mapping": "Allen",
            "output_mappings": list(mapping_order),
            "regional_summary": "mean",
            "histogram_bins": dataset.histogram_bins,
            "presentation": "neutral Linear/Full",
            "features": [
                {
                    "id": feature.id,
                    "input_kind": feature._regional.input_kind,
                    "aggregation": feature._regional.aggregation,
                    "hemisphere_policy": feature._regional.hemisphere_policy,
                    **(
                        {"output_mappings": list(feature._regional.output_mappings)}
                        if feature._regional.output_mappings != ("Allen",)
                        else {}
                    ),
                }
                for feature in sorted(dataset.features, key=lambda item: item.id)
                if feature._regional is not None
            ],
            **(
                {
                    "mapping_aggregation": "observation-level remap before arithmetic mean",
                    "mapping": {
                        "authority": "iblatlas.regions.BrainRegions.remap",
                        "operation": "fold signed Allen identities, remap each source observation row, then aggregate by arithmetic mean",
                        "unmapped_policy": "error on void or root target",
                    },
                }
                if mapping_order != ("Allen",)
                else {}
            ),
        }
        notes = [
            "Regional values are represented on folded logical Allen identities; independent left/right regional scalars are unsupported.",
            "No display scale, focus domain, palette, or scientific transform was inferred by the authoring package.",
        ]
    else:
        recipe = {
            "id": (
                "ibl-ephys-atlas-mixed-authoring-v1"
                if observations
                else "ibl-ephys-atlas-volume-authoring-v1"
            ),
            "histogram_bins": dataset.histogram_bins,
            "presentation": "neutral Linear/Full",
            "volume_transport": "deterministic chunks3d gzip",
            "volume_features": [
                {
                    "id": feature.id,
                    "reference_space_id": feature._volume.grid.reference_space_id,
                    "grid_id": feature._volume.grid.grid_id,
                    "atlas_class": feature._volume.grid.atlas_class,
                    "iblatlas_version": feature._volume.grid.iblatlas_version,
                    "resolution_um": feature._volume.grid.resolution_um,
                    "array_axes": list(feature._volume.grid.array_axes),
                    "shape": list(feature._volume.grid.shape),
                    "index_to_world_um": list(feature._volume.grid.index_to_world_um),
                    "index_convention": "integer-centers-half-integer-edges",
                    "validity": feature._volume.validity.kind,
                    **(
                        {"outside_value": feature._volume.validity.outside_value}
                        if feature._volume.validity.kind == "sentinel"
                        else {"validity_codes": {"valid": 0, "outside": 1, "missing": 2}}
                    ),
                    "classification_order": ["outside", "missing", "valid"],
                    "dtype": (
                        "float16"
                        if feature._volume.values.dtype.itemsize == 2
                        else "float32"
                    ),
                    "chunk_shape": list(feature._volume.chunk_shape),
                }
                for feature in sorted(dataset.features, key=lambda item: item.id)
                if feature._volume is not None
            ],
            **(
                {
                    "regional": {
                        "source_mapping": "Allen",
                        "output_mappings": list(mapping_order),
                        "summary": "mean",
                    }
                }
                if observations
                else {}
            ),
        }
        notes = [
            "Volume values retain their submitted float16 or float32 dtype and physical laterality; no registration, resampling, interpolation, normalization, clipping, or denoising was performed.",
            "Volume geometry came from an already-created iblatlas AllenAtlas BrainCoordinates object and was verified independently of value shape.",
            "Volume statistics and distributions include explicitly valid voxels only.",
            "No display scale, focus domain, palette, or scientific transform was inferred by the authoring package.",
            *(
                ["Regional values are represented on folded logical Allen identities; independent left/right regional scalars are unsupported."]
                if observations
                else []
            ),
        ]
    manifest = {
        "schema_version": "1.0",
        "dataset_id": dataset.dataset_id,
        "title": dataset.title,
        "description": dataset.description,
        "release": {
            "release_id": dataset.release_id,
            "immutable": True,
            "created_at": dataset.created_at,
        },
        "provenance": {
            "sources": source_documents,
            "builder": {
                "name": "ibl-ephys-atlas",
                "version": _authoring_version(),
                "repository": "rossant/ibl-ephys-atlas-web-v2",
                "command": "ibl_ephys_atlas.Dataset.write_zip",
            },
            "recipe": recipe,
            "notes": notes,
        },
        "parcellations": parcellations,
        "features": feature_refs,
        "artifacts": [],
    }
    write_json(release_dir / "manifest.json", manifest)
    return release_dir

