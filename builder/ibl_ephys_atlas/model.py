"""Public, explicit schema-v1 regional authoring model."""

from __future__ import annotations

from dataclasses import dataclass, fields
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
import re
import tempfile
from typing import Any, Literal, Sequence

import numpy as np

from ephys_atlas_builder.bundle import write_bundle
from ephys_atlas_builder.io import json_resource, write_json
from ephys_atlas_builder.regional_release import (
    linear_full_display,
    write_feature_parcellation,
    write_parcellation,
)
from ephys_atlas_builder.validate import FORMAT_CHECKER

from .regional import RegionalObservations, normalize_regional_input
from .volume import (
    AllenCCFGrid,
    VolumeData,
    VoxelValidity,
    normalize_volume_input,
    write_volume_representation,
)


_DATASET_ID = re.compile(r"^[a-z0-9][a-z0-9._-]*$")
_IDENTIFIER = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._-]*$")
_SOURCE_ROLES = {
    "scientific-code",
    "canonical-data",
    "selection-freeze",
    "publication-input",
    "user-input",
    "atlas-geometry",
}


def _authoring_version() -> str:
    try:
        return version("ibl-ephys-atlas")
    except PackageNotFoundError:
        from ephys_atlas_builder import __version__ as editable_version

        return editable_version


@dataclass(frozen=True)
class ValidationIssue:
    severity: Literal["error", "warning"]
    code: str
    location: str
    message: str
    hint: str | None = None


@dataclass(frozen=True)
class ValidationReport:
    issues: tuple[ValidationIssue, ...] = ()

    @property
    def errors(self) -> tuple[ValidationIssue, ...]:
        return tuple(issue for issue in self.issues if issue.severity == "error")

    @property
    def warnings(self) -> tuple[ValidationIssue, ...]:
        return tuple(issue for issue in self.issues if issue.severity == "warning")

    @property
    def valid(self) -> bool:
        return not self.errors

    def raise_for_errors(self) -> None:
        if self.errors:
            raise BundleValidationError(self)


class BundleValidationError(ValueError):
    def __init__(self, report: ValidationReport):
        self.report = report
        summary = "; ".join(
            f"{issue.location}: {issue.message}" for issue in report.errors
        )
        super().__init__(summary or "bundle validation failed")


@dataclass(frozen=True)
class Source:
    role: str
    description: str
    repository: str | None = None
    commit: str | None = None
    path: str | None = None
    release: str | None = None
    uri: str | None = None
    sha256: str | None = None
    license: str | None = None

    @classmethod
    def user_input(cls, *, description: str, **identity: str) -> "Source":
        return cls(role="user-input", description=description, **identity)

    def to_document(self) -> dict[str, str]:
        return {
            field.name: value
            for field in fields(self)
            if (value := getattr(self, field.name)) is not None
        }


@dataclass(frozen=True)
class ValueSemantics:
    quantity: str
    transform: str
    source_population: str
    missing_values: str
    source_column: str | None = None
    qc_filter: str | None = None

    def to_document(self) -> dict[str, str]:
        return {
            field.name: value
            for field in fields(self)
            if (value := getattr(self, field.name)) is not None
        }


class Feature:
    def __init__(
        self,
        *,
        identifier: str,
        label: str,
        semantics: ValueSemantics,
        description: str = "",
        unit: str | None = None,
    ) -> None:
        self.id = identifier
        self.label = label
        self.description = description
        self.unit = unit
        self.semantics = semantics
        self._regional: RegionalObservations | None = None
        self._volume: VolumeData | None = None

    def _add_regions(
        self,
        *,
        values: Any,
        ontology: Any,
        region_ids: Any | None,
        acronyms: Any | None,
        source_mapping: str,
        output_mappings: Sequence[str],
        hemisphere_policy: str,
        aggregation: str,
        require_unique: bool,
    ) -> "Feature":
        if self._regional is not None:
            raise ValueError(f"feature {self.id} already has a regional representation")
        self._regional = normalize_regional_input(
            values=values,
            ontology=ontology,
            region_ids=region_ids,
            acronyms=acronyms,
            source_mapping=source_mapping,
            output_mappings=output_mappings,
            hemisphere_policy=hemisphere_policy,
            aggregation=aggregation,
            require_unique=require_unique,
        )
        return self

    def add_region_values(
        self,
        *,
        values: Any,
        ontology: Any,
        region_ids: Any | None = None,
        acronyms: Any | None = None,
        source_mapping: str = "Allen",
        output_mappings: Sequence[str] = ("Allen",),
        hemisphere_policy: str = "non_lateralized",
    ) -> "Feature":
        """Attach one already-aggregated scalar per folded logical region."""
        return self._add_regions(
            values=values,
            ontology=ontology,
            region_ids=region_ids,
            acronyms=acronyms,
            source_mapping=source_mapping,
            output_mappings=output_mappings,
            hemisphere_policy=hemisphere_policy,
            aggregation="mean",
            require_unique=True,
        )

    def add_region_observations(
        self,
        *,
        values: Any,
        ontology: Any,
        aggregation: str,
        region_ids: Any | None = None,
        acronyms: Any | None = None,
        source_mapping: str = "Allen",
        output_mappings: Sequence[str] = ("Allen",),
        hemisphere_policy: str = "non_lateralized",
    ) -> "Feature":
        """Attach observation rows with an explicit arithmetic-mean aggregation."""
        return self._add_regions(
            values=values,
            ontology=ontology,
            region_ids=region_ids,
            acronyms=acronyms,
            source_mapping=source_mapping,
            output_mappings=output_mappings,
            hemisphere_policy=hemisphere_policy,
            aggregation=aggregation,
            require_unique=False,
        )

    def add_volume(
        self,
        *,
        values: Any,
        grid: AllenCCFGrid,
        validity: VoxelValidity,
        chunk_shape: Sequence[int] = (64, 64, 64),
    ) -> "Feature":
        """Attach one precomputed scalar volume on an explicit Allen CCF grid."""
        if self._volume is not None:
            raise ValueError(f"feature {self.id} already has a volume representation")
        self._volume = normalize_volume_input(
            values=values,
            grid=grid,
            validity=validity,
            chunk_shape=chunk_shape,
        )
        return self


class Dataset:
    def __init__(
        self,
        *,
        dataset_id: str,
        release_id: str,
        title: str,
        created_at: str,
        sources: Sequence[Source],
        description: str = "",
        histogram_bins: int = 50,
    ) -> None:
        self.dataset_id = dataset_id
        self.release_id = release_id
        self.title = title
        self.description = description
        self.created_at = created_at
        self.sources = tuple(sources)
        self.histogram_bins = histogram_bins
        self._features: dict[str, Feature] = {}

    @property
    def features(self) -> tuple[Feature, ...]:
        return tuple(self._features.values())

    def add_feature(
        self,
        *,
        id: str,
        label: str,
        semantics: ValueSemantics,
        description: str = "",
        unit: str | None = None,
    ) -> Feature:
        if id in self._features:
            raise ValueError(f"duplicate feature id: {id}")
        feature = Feature(
            identifier=id,
            label=label,
            description=description,
            unit=unit,
            semantics=semantics,
        )
        self._features[id] = feature
        return feature

    def validate(self) -> ValidationReport:
        issues: list[ValidationIssue] = []

        def error(code: str, location: str, message: str, hint: str | None = None) -> None:
            issues.append(ValidationIssue("error", code, location, message, hint))

        if not _DATASET_ID.fullmatch(self.dataset_id):
            error("dataset.id.invalid", "dataset_id", "dataset_id is not a schema-v1 dataset identifier")
        if not self.release_id:
            error("dataset.release_id.required", "release_id", "release_id is required")
        if not self.title:
            error("dataset.title.required", "title", "title is required")
        if not isinstance(self.description, str):
            error("dataset.description.invalid", "description", "description must be a string")
        if not isinstance(self.created_at, str) or not FORMAT_CHECKER.conforms(
            self.created_at, "date-time"
        ):
            error(
                "dataset.created_at.invalid",
                "created_at",
                "an explicit valid RFC3339 timestamp is required",
            )
        if isinstance(self.histogram_bins, bool) or not isinstance(self.histogram_bins, int) or self.histogram_bins < 2:
            error("dataset.histogram_bins.invalid", "histogram_bins", "histogram_bins must be an integer of at least 2")
        if not self.sources:
            error("dataset.sources.required", "sources", "at least one explicit provenance source is required")
        for index, source in enumerate(self.sources):
            location = f"sources[{index}]"
            if not isinstance(source, Source):
                error("source.type.invalid", location, "sources must contain Source objects")
                continue
            if source.role not in _SOURCE_ROLES:
                error("source.role.invalid", f"{location}.role", f"unsupported source role: {source.role}")
            if not source.description:
                error("source.description.required", f"{location}.description", "source description is required")
            if source.sha256 is not None and not re.fullmatch(r"[0-9a-f]{64}", source.sha256):
                error("source.sha256.invalid", f"{location}.sha256", "source SHA-256 must contain 64 lowercase hex characters")
            if source.commit is not None and not re.fullmatch(r"[0-9a-f]{7,40}", source.commit):
                error("source.commit.invalid", f"{location}.commit", "source commit must contain 7-40 lowercase hex characters")
        if not self._features:
            error("dataset.features.required", "features", "at least one feature is required")
        for feature_id, feature in self._features.items():
            base = f"features.{feature_id}"
            if not _IDENTIFIER.fullmatch(feature_id):
                error("feature.id.invalid", f"{base}.id", "feature id is not a safe schema-v1 identifier")
            if not feature.label:
                error("feature.label.required", f"{base}.label", "feature label is required")
            if not isinstance(feature.description, str):
                error("feature.description.invalid", f"{base}.description", "feature description must be a string")
            if feature.unit is not None and not isinstance(feature.unit, str):
                error("feature.unit.invalid", f"{base}.unit", "feature unit must be a string or None")
            if not isinstance(feature.semantics, ValueSemantics):
                error("feature.semantics.invalid", f"{base}.semantics", "semantics must be ValueSemantics")
            else:
                for name in ("quantity", "transform", "source_population", "missing_values"):
                    if not getattr(feature.semantics, name):
                        error("feature.semantics.required", f"{base}.semantics.{name}", f"{name} is required")
            if feature._regional is None and feature._volume is None:
                error(
                    "feature.representation.required",
                    f"{base}.representations",
                    "at least one regional or volume representation is required",
                )
        return ValidationReport(tuple(issues))

    def _build_release(self, release_dir: Path) -> Path:
        self.validate().raise_for_errors()
        observations = [
            feature._regional
            for feature in self.features
            if feature._regional is not None
        ]
        volumes = [
            feature._volume
            for feature in self.features
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
        for feature in sorted(self.features, key=lambda item: item.id):
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
                        self.histogram_bins,
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
                    feature_root, feature._volume, self.histogram_bins
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
        source_documents = [source.to_document() for source in self.sources]
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
                "histogram_bins": self.histogram_bins,
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
                    for feature in sorted(self.features, key=lambda item: item.id)
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
                "histogram_bins": self.histogram_bins,
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
                    for feature in sorted(self.features, key=lambda item: item.id)
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
            "dataset_id": self.dataset_id,
            "title": self.title,
            "description": self.description,
            "release": {
                "release_id": self.release_id,
                "immutable": True,
                "created_at": self.created_at,
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

    def write_zip(self, output: str | Path) -> dict[str, Any]:
        """Build, independently validate, and atomically write one local bundle."""
        self.validate().raise_for_errors()
        with tempfile.TemporaryDirectory(prefix="ibl-ephys-atlas-authoring-") as temporary:
            release_dir = self._build_release(Path(temporary) / "release")
            return write_bundle(release_dir, Path(output))
