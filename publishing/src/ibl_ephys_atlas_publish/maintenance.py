from __future__ import annotations

from datetime import datetime, timezone
import os
from pathlib import Path
import shutil

from .core import PublicationStore
from .locks import MutationLock


def _latest_mtime(path: Path) -> float:
    latest = path.stat().st_mtime
    for root, directories, files in os.walk(path):
        for name in [*directories, *files]:
            candidate = Path(root) / name
            try:
                latest = max(latest, candidate.stat().st_mtime)
            except FileNotFoundError:
                # Concurrent filesystem changes are harmless under the mutation
                # lock, but tolerate external/manual cleanup as well.
                continue
    return latest


def cleanup_stale_uploads(
    store: PublicationStore,
    *,
    older_than_seconds: float,
    now: datetime | None = None,
) -> list[str]:
    """Remove inactive staging uploads older than the requested age.

    Inactivity is based on the newest mtime anywhere in an upload directory, so
    a long-running resumable upload remains live as chunks arrive. Cleanup uses
    the same process-wide filesystem lock as WSGI mutations.
    """
    if older_than_seconds <= 0:
        raise ValueError("older_than_seconds must be positive")
    current = now or datetime.now(timezone.utc)
    cutoff = current.timestamp() - older_than_seconds
    removed: list[str] = []
    lock = MutationLock(store.state / ".mutation.lock")
    with lock.hold():
        if not store.staging.exists():
            return removed
        for upload in sorted(store.staging.iterdir()):
            if not upload.is_dir():
                continue
            try:
                latest = _latest_mtime(upload)
            except FileNotFoundError:
                continue
            if latest > cutoff:
                continue
            shutil.rmtree(upload)
            removed.append(upload.name)
    return removed
