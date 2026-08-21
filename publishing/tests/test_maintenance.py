from __future__ import annotations

from datetime import datetime, timezone
import os

import pytest

from ibl_ephys_atlas_publish.core import PublicationStore
from ibl_ephys_atlas_publish.maintenance import cleanup_stale_uploads


def _set_tree_mtime(path, timestamp: float) -> None:
    for item in sorted(path.rglob("*"), reverse=True):
        os.utime(item, (timestamp, timestamp))
    os.utime(path, (timestamp, timestamp))


def test_cleanup_removes_only_inactive_staging_uploads(tmp_path):
    store = PublicationStore(tmp_path)
    stale = store.staging / "stale-upload"
    fresh = store.staging / "fresh-upload"
    active = store.staging / "active-upload"
    for path in (stale, fresh, active):
        (path / "files").mkdir(parents=True)
        (path / "upload.json").write_text("{}")
    (active / "files" / "chunk.bin").write_bytes(b"new chunk")

    now = datetime(2026, 8, 21, 8, 0, tzinfo=timezone.utc)
    _set_tree_mtime(stale, now.timestamp() - 10 * 3600)
    _set_tree_mtime(fresh, now.timestamp() - 30 * 60)
    _set_tree_mtime(active, now.timestamp() - 10 * 3600)
    os.utime(active / "files" / "chunk.bin", (now.timestamp() - 5 * 60,) * 2)

    removed = cleanup_stale_uploads(store, older_than_seconds=3600, now=now)

    assert removed == ["stale-upload"]
    assert not stale.exists()
    assert fresh.exists()
    assert active.exists()


def test_cleanup_requires_positive_age(tmp_path):
    store = PublicationStore(tmp_path)
    with pytest.raises(ValueError, match="positive"):
        cleanup_stale_uploads(store, older_than_seconds=0)
