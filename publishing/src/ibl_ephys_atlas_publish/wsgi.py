from __future__ import annotations

import os

from .auth import CredentialRegistry
from .core import PublicationStore
from .service import PublishingApplication


def create_app() -> PublishingApplication:
    storage = os.environ["IBL_PUBLISH_STORAGE"]
    credentials = os.environ["IBL_PUBLISH_CREDENTIALS"]
    validator = os.environ.get("IBL_PUBLISH_VALIDATOR")
    return PublishingApplication(
        PublicationStore(storage, validator_command=validator),
        CredentialRegistry(credentials),
    )


application = create_app()
