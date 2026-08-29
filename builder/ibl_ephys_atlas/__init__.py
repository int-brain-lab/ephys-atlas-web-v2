"""Public authoring API for IBL Ephys Atlas schema-v1 local bundles."""

from .model import (
    BundleValidationError,
    Dataset,
    Feature,
    Source,
    ValidationIssue,
    ValidationReport,
    ValueSemantics,
    _authoring_version,
)
from .volume import AllenCCFGrid, VoxelValidity

__all__ = [
    "AllenCCFGrid",
    "BundleValidationError",
    "Dataset",
    "Feature",
    "Source",
    "ValidationIssue",
    "ValidationReport",
    "ValueSemantics",
    "VoxelValidity",
]

__version__ = _authoring_version()
