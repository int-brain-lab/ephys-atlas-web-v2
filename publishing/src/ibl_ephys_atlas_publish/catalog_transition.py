"""Preserve published discovery identities unless their retirement is explicit."""
from __future__ import annotations

import hashlib
import json

from .errors import ValidationError


def catalog_hash(catalog: dict) -> str:
    """Hash the canonical catalog bytes used by publication history."""
    raw = (json.dumps(catalog, sort_keys=True, separators=(",", ":")) + "\n").encode()
    return hashlib.sha256(raw).hexdigest()


def catalog_inventory(catalog: dict) -> dict[str, list[str]]:
    return {
        "projects": sorted(p["project_id"] for p in catalog["projects"]),
        "datasets": sorted(d["dataset_id"] for d in catalog["datasets"]),
        "releases": sorted(f'{d["dataset_id"]}/{r["release_id"]}'
                           for d in catalog["datasets"] for r in d["releases"]),
        "editions": sorted(f'{p["project_id"]}/{e["edition_id"]}'
                           for p in catalog["projects"] for e in p["editions"]),
    }


def validate_catalog_transition(previous: dict | None, candidate: dict,
                                retirement: dict | None = None) -> dict:
    """Reject omissions before writes; a retirement must match this exact baseline.

    This is administrative authorization evidence, separate from schema v1.
    It never permits remapping an immutable edition or altering release bytes.
    """
    before = catalog_inventory(previous) if previous is not None else {
        key: [] for key in catalog_inventory(candidate)
    }
    after = catalog_inventory(candidate)
    removed = {key: sorted(set(before[key]) - set(after[key])) for key in before}
    added = {key: sorted(set(after[key]) - set(before[key])) for key in before}
    if retirement is not None:
        if (not isinstance(retirement, dict)
                or set(retirement) != {"baseline_sha256", "removed", "reason", "decision"}
                or previous is None
                or retirement["baseline_sha256"] != catalog_hash(previous)
                or retirement["removed"] != removed
                or not any(removed.values())
                or any(not isinstance(retirement[key], str) or not retirement[key].strip()
                       for key in ("reason", "decision"))):
            raise ValidationError("retirement record must name the exact baseline, removals, reason and decision")
    elif any(removed.values()):
        raise ValidationError("catalog removal requires an explicit retirement record: "
                              + json.dumps(removed, sort_keys=True))
    return {"added": added, "removed": removed, "retirement": retirement}
