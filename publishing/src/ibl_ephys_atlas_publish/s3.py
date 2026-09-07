"""Conditional, object-resumable S3 release publication (no catalog mutation).

AWS CLI is the credential boundary; importing or planning never contacts AWS.
The repository entry point supplies the canonical production preflight.
"""
from __future__ import annotations

import base64
from dataclasses import dataclass
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
from typing import Any, Protocol

from .client import file_info
from .core import Conflict, ValidationError, _id, _relpath

BUCKET = "ibl-brain-wide-map-private"
PREFIX = "aggregates/atlas/ephys-atlas-web-v2"
IMMUTABLE_CACHE = "public,max-age=31536000,immutable"
MUTABLE_CACHE = "no-cache"
# This first implementation deliberately rejects multipart-sized objects.
MAX_OBJECT_BYTES = 5_000_000_000


def json_bytes(value: Any) -> bytes:
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()


@dataclass(frozen=True)
class Destination:
    environment: str

    def __post_init__(self):
        if self.environment not in {"staging", "production"}:
            raise ValidationError("environment must be staging or production")

    @property
    def root(self) -> str:
        return f"{PREFIX}/{self.environment}/"

    def key(self, relative: str) -> str:
        return self.root + _relpath(relative)


class ObjectStore(Protocol):
    def head(self, key: str) -> dict | None: ...
    def get_json(self, key: str) -> tuple[dict, str] | None: ...
    def put(self, key: str, path: Path, *, sha256: str, content_type: str,
            cache_control: str, expected_etag: str | None = None) -> None: ...


class AwsCliStore:
    def __init__(self, destination: Destination, profile: str):
        if not profile or profile.startswith("-"):
            raise ValidationError("an explicit AWS profile is required")
        self.destination = destination
        self.profile = profile

    def _absent_with_scoped_listing(self, key: str) -> bool:
        # Prefix-limited ListBucket does not always turn missing-object HEADs
        # into 404s. Prove absence with a successful exact-prefix listing; an
        # AccessDenied response alone never grants permission to create.
        result = subprocess.run([
            "aws", "--profile", self.profile, "--region", "us-east-1",
            "--no-cli-pager", "--output", "json", "s3api", "list-objects-v2",
            "--bucket", BUCKET, "--prefix", key, "--max-keys", "1", "--no-paginate",
        ], capture_output=True, text=True)
        if result.returncode:
            return False
        value = json.loads(result.stdout)
        entries = value.get("Contents", [])
        if (not isinstance(entries, list) or value.get("KeyCount") != len(entries)
                or any(not isinstance(entry, dict) or not isinstance(entry.get("Key"), str) for entry in entries)):
            raise ValidationError("invalid S3 listing response")
        return not any(entry["Key"] == key for entry in entries)

    def _run(self, operation: str, key: str, *arguments: str) -> dict | None:
        if not key.startswith(self.destination.root):
            raise ValidationError("S3 key escapes the selected deployment root")
        _relpath(key[len(self.destination.root):])
        result = subprocess.run([
            "aws", "--profile", self.profile, "--region", "us-east-1",
            "--no-cli-pager", "--output", "json", "s3api", operation,
            "--bucket", BUCKET, "--key", key, *arguments,
        ], capture_output=True, text=True)
        if result.returncode:
            # Do not mistake denied credentials, timeouts, or 5xx for absence.
            if operation in {"head-object", "get-object"} and any(
                code in result.stderr for code in ("(404)", "(NoSuchKey)", "(NotFound)")
            ):
                return None
            if (operation in {"head-object", "get-object"}
                    and any(code in result.stderr for code in ("(403)", "(AccessDenied)"))
                    and self._absent_with_scoped_listing(key)):
                return None
            if "(PreconditionFailed)" in result.stderr or "(412)" in result.stderr:
                raise Conflict(f"conditional S3 write conflict: {key}")
            raise ValidationError(f"AWS {operation} failed for {key}: {result.stderr.strip()}")
        return json.loads(result.stdout or "{}")

    def head(self, key: str) -> dict | None:
        return self._run("head-object", key, "--checksum-mode", "ENABLED")

    def get_json(self, key: str) -> tuple[dict, str] | None:
        with tempfile.TemporaryDirectory(prefix="atlas-s3-read-") as temporary:
            path = Path(temporary) / "object.json"
            result = self._run("get-object", key, "--checksum-mode", "ENABLED", str(path))
            if result is None:
                return None
            value = json.loads(path.read_bytes())
            if not isinstance(value, dict) or not isinstance(result.get("ETag"), str):
                raise ValidationError(f"invalid remote JSON object: {key}")
            return value, result["ETag"]

    def put(self, key: str, path: Path, *, sha256: str, content_type: str,
            cache_control: str, expected_etag: str | None = None) -> None:
        condition = ("--if-match", expected_etag) if expected_etag is not None else ("--if-none-match", "*")
        self._run("put-object", key, "--body", str(path),
                  "--checksum-algorithm", "SHA256", "--checksum-sha256", checksum(sha256),
                  "--content-type", content_type, "--cache-control", cache_control, *condition)


def checksum(sha256: str) -> str:
    return base64.b64encode(bytes.fromhex(sha256)).decode("ascii")


def content_type(path: str) -> str:
    # gzip is an opaque application payload, never HTTP Content-Encoding.
    if path.endswith(".json"):
        return "application/json"
    if path.endswith(".svg"):
        return "image/svg+xml"
    return "application/octet-stream"


def release_plan(root: Path, destination: Destination, files: list[str], aliases: list[str]) -> dict:
    """Describe a previously preflighted snapshot; never read credentials/network."""
    manifest = json.loads((root / "manifest.json").read_bytes())
    dataset = _id(manifest["dataset_id"], "dataset id")
    release = _id(manifest["release"]["release_id"], "release id")
    if dataset == "local":
        raise ValidationError("reserved local dataset identity")
    artifacts = []
    for relative in sorted(set(files)):
        relative = _relpath(relative)
        path = root / relative
        if not path.is_file() or path.is_symlink() or root.resolve() not in path.resolve().parents:
            raise ValidationError(f"not a regular contained artifact: {relative}")
        info = file_info(path)
        if info["size"] > MAX_OBJECT_BYTES:
            raise ValidationError(f"multipart upload is not implemented: {relative}")
        artifacts.append({"path": relative, **info, "content_type": content_type(relative)})
    if not any(item["path"] == "manifest.json" for item in artifacts):
        raise ValidationError("manifest.json is required")
    plan = {
        "dataset_id": dataset, "release_id": release, "bucket": BUCKET,
        "root": destination.root, "aliases": sorted({_id(alias, "alias") for alias in aliases}),
        "artifacts": artifacts,
    }
    # Aliases are not part of immutable release identity or staging identity.
    plan["transaction_id"] = hashlib.sha256(json_bytes({k: v for k, v in plan.items() if k != "aliases"})).hexdigest()
    return plan


def _verify_head(head: dict, artifact: dict, cache: str, key: str) -> None:
    if (head.get("ContentLength") != artifact["size"]
            or head.get("ChecksumSHA256") != checksum(artifact["sha256"])
            or head.get("ContentType") != artifact["content_type"]
            or head.get("CacheControl") != cache
            or head.get("ContentEncoding")):
        raise Conflict(f"existing S3 bytes or serving metadata differ: {key}")


def _create_verified(store: ObjectStore, key: str, path: Path, artifact: dict, cache: str) -> None:
    head = store.head(key)
    if head is None:
        # Recheck immediately before upload; S3 additionally validates this
        # SHA against the transmitted body if the local file changes in flight.
        if file_info(path) != {k: artifact[k] for k in ("size", "sha256")}:
            raise ValidationError(f"local artifact changed: {path}")
        try:
            store.put(key, path, sha256=artifact["sha256"],
                      content_type=artifact["content_type"], cache_control=cache)
        except Conflict:
            # Another identical writer may have won. Different bytes still fail.
            pass
        head = store.head(key)
    if head is None:
        raise ValidationError(f"uploaded object is absent: {key}")
    _verify_head(head, artifact, cache, key)


def publish_release(root: Path, destination: Destination, plan: dict, store: ObjectStore) -> dict:
    """Stage and verify all objects, complete immutable release, then CAS index.

    Retry the same command to reuse verified objects. An index race fails
    closed; a retry re-reads the index and preserves the other publisher's work.
    This function must receive a private snapshot validated by the entry point.
    """
    if plan != release_plan(root, destination, [a["path"] for a in plan["artifacts"]], plan["aliases"]):
        raise ValidationError("release snapshot or destination differs from plan")
    dataset, release = plan["dataset_id"], plan["release_id"]
    prefix = f"datasets/{dataset}/releases/{release}/"
    index_key = destination.key(f"datasets/{dataset}/index.json")
    current = store.get_json(index_key)
    index, etag = current if current is not None else ({
        "dataset_id": dataset, "metadata": {}, "archived": False, "releases": [], "aliases": {},
    }, None)
    if index.get("dataset_id") != dataset or index.get("archived") is not False:
        raise Conflict("dataset identity mismatch or dataset archived")
    if not isinstance(index.get("releases"), list) or not isinstance(index.get("aliases"), dict):
        raise ValidationError("invalid remote dataset index")
    known = set()
    for item in index["releases"]:
        if not isinstance(item, dict):
            raise ValidationError("invalid remote release entry")
        identity = _id(item.get("release_id"), "remote release id")
        if identity in known:
            raise ValidationError("duplicate remote release entry")
        known.add(identity)
    for alias, target in index["aliases"].items():
        _id(alias, "remote alias")
        if _id(target, "remote alias target") not in known:
            raise ValidationError("remote alias references missing release")
    publication = {"dataset_id": dataset, "release_id": release,
                   "transaction_id": plan["transaction_id"], "artifacts": plan["artifacts"]}
    # Reserve the identity privately first. Distinct plans cannot combine their
    # objects under one release ID, even after interruptions or concurrent runs.
    with tempfile.TemporaryDirectory(prefix="atlas-s3-transaction-") as temporary:
        metadata = Path(temporary) / "publication.json"
        metadata.write_bytes(json_bytes(publication))
        descriptor = {**file_info(metadata), "content_type": "application/json"}
        _create_verified(store, destination.key(f"_staging/releases/{dataset}/{release}.json"),
                         metadata, descriptor, MUTABLE_CACHE)
        for artifact in plan["artifacts"]:
            _create_verified(store, destination.key(f"_staging/{plan['transaction_id']}/{artifact['path']}"),
                             root / artifact["path"], artifact, MUTABLE_CACHE)
        # No manifest is exposed until every dependency is verified remotely.
        for artifact in sorted(plan["artifacts"], key=lambda item: item["path"] == "manifest.json"):
            _create_verified(store, destination.key(prefix + artifact["path"]),
                             root / artifact["path"], artifact, IMMUTABLE_CACHE)
        _create_verified(store, destination.root + prefix + "_publication.json",
                         metadata, descriptor, IMMUTABLE_CACHE)
        if not any(item.get("release_id") == release for item in index["releases"]):
            index["releases"].append({"release_id": release})
        for alias in plan["aliases"]:
            index["aliases"][alias] = release
        metadata.write_bytes(json_bytes(index))
        store.put(index_key, metadata, sha256=file_info(metadata)["sha256"],
                  content_type="application/json", cache_control=MUTABLE_CACHE, expected_etag=etag)
        head = store.head(index_key)
        if head is None:
            raise ValidationError("dataset index is absent after conditional update")
        _verify_head(head, {**file_info(metadata), "content_type": "application/json"}, MUTABLE_CACHE, index_key)
    return {"dataset_id": dataset, "release_id": release, "transaction_id": plan["transaction_id"],
            "index_key": index_key, "catalog_changed": False}
