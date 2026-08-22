"""Allen grey-matter scope selection and nullable reduced mappings."""

from __future__ import annotations

from typing import Any

GREY_ROOT_ALLEN_ID = 8


def select_grey_matter_source_ids(active_ids: set[int], catalog: dict[str, Any]) -> dict[str, Any]:
    rows = [row for row in catalog.get("mappings", {}).get("allen", []) if isinstance(row.get("atlas_id"), int) and row["atlas_id"] > 0]
    if not any(row["atlas_id"] == 8 and row.get("acronym") == "grey" for row in rows):
        raise ValueError("Allen catalog is missing the canonical grey-matter root 8/grey")
    children: dict[int, list[int]] = {}
    for row in rows:
        if row.get("parent_id") is not None:
            children.setdefault(row["parent_id"], []).append(row["atlas_id"])
    grey: set[int] = set()
    pending = [GREY_ROOT_ALLEN_ID]
    while pending:
        current = pending.pop()
        if current in grey:
            continue
        grey.add(current)
        pending.extend(children.get(current, []))
    included = active_ids & grey

    def has_active_descendant(identifier: int, visiting: set[int]) -> bool:
        if identifier in visiting:
            raise ValueError(f"Allen hierarchy cycle at {identifier}")
        return any(child in included or has_active_descendant(child, visiting | {identifier}) for child in children.get(identifier, []))

    return {
        "root_allen_id": 8,
        "included_active_ids": included,
        "excluded_non_grey_active_ids": active_ids - grey,
        "renderable_ids": {identifier for identifier in included if not has_active_descendant(identifier, set())},
    }


def resolve_mapping(source_allen_id: int, mapping: str, catalog: dict[str, Any]) -> int | None:
    if mapping == "allen":
        return source_allen_id
    allen_rows = {row["atlas_id"]: row for row in catalog["mappings"]["allen"] if row["atlas_id"] > 0}
    members = {row["atlas_id"] for row in catalog["mappings"][mapping] if row["atlas_id"] > 0 and row["atlas_id"] != 997 and row.get("mapping_member")}
    current = source_allen_id
    visited: set[int] = set()
    while current in allen_rows and current not in visited:
        if current in members:
            return current
        visited.add(current)
        parent = allen_rows[current].get("parent_id")
        if parent is None:
            break
        current = parent
    return None
