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

__all__ = [
    "BundleValidationError",
    "Dataset",
    "Feature",
    "Source",
    "ValidationIssue",
    "ValidationReport",
    "ValueSemantics",
]

__version__ = _authoring_version()
