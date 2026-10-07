"""Public facade for development-bundle parsing, sync, and validation."""

from __future__ import annotations

from pathlib import Path
from typing import Any
from urllib.request import Request

from ._development_bundle_descriptor import (
    DevelopmentBundleError,
    ValidatedArtifact,
    ValidatedDevelopmentBundle,
    load_development_bundle,
)
from ._development_bundle_validation import (
    _validate_release_directory,
    validate_development_bundle,
)
from . import _development_bundle_acquisition as _acquisition
from ._development_bundle_acquisition import FetchResource, FreeSpace

_RejectRedirects = _acquisition._RejectRedirects
_PINNED_OPENER = _acquisition._PINNED_OPENER


def _open_pinned_url(request: Request) -> Any:
    return _PINNED_OPENER.open(request, timeout=60)


def _default_fetch(url: str, maximum_bytes: int) -> bytes:
    # Keep the historical facade patch point used by callers and tests.
    return _acquisition._default_fetch(
        url, maximum_bytes, open_pinned_url=_open_pinned_url
    )


def sync_development_bundle(
    path: Path,
    repository_root: Path | None = None,
    fetch: FetchResource | None = None,
    free_space: FreeSpace | None = None,
) -> ValidatedDevelopmentBundle:
    """Fetch absent resolved artifacts atomically, then validate the complete bundle."""
    return _acquisition.sync_development_bundle(
        path, repository_root, fetch or _default_fetch, free_space
    )
