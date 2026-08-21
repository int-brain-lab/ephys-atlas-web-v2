from __future__ import annotations

import os

from .auth import CredentialRegistry
from .core import PublicationStore
from .service import DEFAULT_MAX_CHUNK_BYTES, DEFAULT_MAX_JSON_BYTES, PublishingApplication


def _positive_size_from_env(name: str, default: int) -> int:
    value = int(os.environ.get(name, default))
    if value <= 0:
        raise ValueError(f"{name} must be positive")
    return value


def create_app() -> PublishingApplication:
    storage = os.environ["IBL_PUBLISH_STORAGE"]
    credentials = os.environ["IBL_PUBLISH_CREDENTIALS"]
    validator = os.environ.get("IBL_PUBLISH_VALIDATOR")
    return PublishingApplication(
        PublicationStore(storage, validator_command=validator),
        CredentialRegistry(credentials),
        max_json_bytes=_positive_size_from_env("IBL_PUBLISH_MAX_JSON_BYTES", DEFAULT_MAX_JSON_BYTES),
        max_chunk_bytes=_positive_size_from_env("IBL_PUBLISH_MAX_CHUNK_BYTES", DEFAULT_MAX_CHUNK_BYTES),
    )


application = create_app()
