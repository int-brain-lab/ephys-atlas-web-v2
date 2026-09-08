"""Private staging and create-only publication of validated packs/site builds."""
from __future__ import annotations

import hashlib
from pathlib import Path
import tempfile
import uuid

from .s3_transfer import run_independent
from .client import file_info
from .core import ValidationError, _id, _relpath
from .s3 import (Destination, ObjectStore, MAX_OBJECT_BYTES, IMMUTABLE_CACHE,
                 MUTABLE_CACHE, _create_verified, _verify_head, content_type, json_bytes)

PREFIXES = {"projection": "atlas/projections", "mesh": "atlas/meshes", "site": "site/builds"}
SITE_TYPES = {".html": "text/html", ".js": "text/javascript", ".css": "text/css",
              ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".woff2": "font/woff2"}


def asset_plan(root: Path, destination: Destination, kind: str, identity: str,
               files: list[str], dependencies: list[dict] | None = None) -> dict:
    if kind not in PREFIXES:
        raise ValidationError("unsupported asset kind")
    _id(identity, "asset identity")
    artifacts = []
    for relative in sorted(set(files)):
        _relpath(relative)
        path = root / relative
        if not path.is_file() or path.is_symlink() or root.resolve() not in path.resolve().parents:
            raise ValidationError("asset must be a regular contained file")
        info = file_info(path)
        if info["size"] > MAX_OBJECT_BYTES:
            raise ValidationError("multipart asset upload is not implemented")
        mime = SITE_TYPES.get(path.suffix, content_type(relative)) if kind == "site" else content_type(relative)
        artifacts.append({"path": relative, **info, "content_type": mime})
    entry = "index.html" if kind == "site" else "manifest.json"
    if entry not in files:
        raise ValidationError(f"asset entry is missing: {entry}")
    plan = {"kind": kind, "identity": identity, "root": destination.root,
            "prefix": f"{PREFIXES[kind]}/{identity}/", "entry": entry,
            "artifacts": artifacts, "dependencies": dependencies or []}
    plan["transaction_id"] = hashlib.sha256(json_bytes(plan)).hexdigest()
    return plan


def publish_assets(root: Path, destination: Destination, plan: dict, store: ObjectStore) -> dict:
    if plan != asset_plan(root, destination, plan["kind"], plan["identity"],
                          [a["path"] for a in plan["artifacts"]], plan["dependencies"]):
        raise ValidationError("asset snapshot differs from plan")
    # Verify external dependencies before opening a private transaction.
    for dependency in plan["dependencies"]:
        key = destination.key(dependency["path"])
        head = store.head(key)
        if head is None:
            raise ValidationError(f"external asset dependency is missing: {key}")
        _verify_head(head, dependency, dependency["cache_control"], key)
    # The actual public HTML ETag is the CAS authority, not administrative state.
    entry_key = destination.key("site/index.html")
    head = store.head(entry_key) if plan["kind"] == "site" else None
    etag = head["ETag"] if head is not None else None
    with tempfile.TemporaryDirectory(prefix="atlas-assets-") as temporary:
        path = Path(temporary) / "metadata.json"
        path.write_bytes(json_bytes(plan))
        descriptor = {**file_info(path), "content_type": "application/json"}
        _create_verified(store, destination.key(f"_staging/assets/{plan['kind']}/{plan['identity']}.json"),
                         path, descriptor, IMMUTABLE_CACHE)
        run_independent(store, lambda artifact: _create_verified(
            store, destination.key(f"_staging/{plan['transaction_id']}/{artifact['path']}"),
            root / artifact["path"], artifact, MUTABLE_CACHE), plan["artifacts"])
        run_independent(store, lambda artifact: _create_verified(
            store, destination.key(plan["prefix"] + artifact["path"]),
            root / artifact["path"], artifact, IMMUTABLE_CACHE),
            (a for a in plan["artifacts"] if a["path"] != plan["entry"]))
        entry = next(a for a in plan["artifacts"] if a["path"] == plan["entry"])
        _create_verified(store, destination.key(plan["prefix"] + entry["path"]),
                         root / entry["path"], entry, IMMUTABLE_CACHE)
        _create_verified(store, destination.key(plan["prefix"] + "_publication.json"), path, descriptor, IMMUTABLE_CACHE)
        if plan["kind"] == "site":
            # A unique HTML comment prevents an A→B→A ETag reuse on rollback.
            html = (root / "index.html").read_bytes() + f"\n<!-- atlas-publication:{uuid.uuid4().hex} -->\n".encode()
            path.write_bytes(html)
            store.put(entry_key, path, sha256=file_info(path)["sha256"], content_type="text/html",
                      cache_control=MUTABLE_CACHE, expected_etag=etag)
    return {"kind": plan["kind"], "identity": plan["identity"], "prefix": plan["prefix"],
            "transaction_id": plan["transaction_id"], "catalog_changed": False}
