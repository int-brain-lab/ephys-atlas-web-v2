"""Parsing and structural validation for pinned development-bundle descriptors."""

from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path, PurePosixPath
import re
from typing import Any
from urllib.parse import unquote, urlsplit

SCHEMA_VERSION = "1.0"
KINDS = {"release", "projection_pack", "mesh_pack"}
MATURITIES = {"validated-real-local", "production-intent", "staging", "published-production"}
SHA256 = re.compile(r"^[0-9a-f]{64}$")
SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")


class DevelopmentBundleError(ValueError):
    """A descriptor or one or more pinned artifacts failed validation."""

    def __init__(self, errors: list[str] | str):
        self.errors = [errors] if isinstance(errors, str) else errors
        super().__init__("\n".join(self.errors))


@dataclass(frozen=True)
class ValidatedArtifact:
    role: str
    kind: str
    destination: str
    identity: dict[str, str]
    root: Path
    file_count: int
    stored_bytes: int


@dataclass(frozen=True)
class ValidatedDevelopmentBundle:
    descriptor_path: Path
    bundle_id: str
    default_view: dict[str, str]
    artifacts: tuple[ValidatedArtifact, ...]
    unavailable: tuple[dict[str, Any], ...]

    @property
    def stored_bytes(self) -> int:
        return sum(artifact.stored_bytes for artifact in self.artifacts)


def _runtime_unavailable(raw: dict[str, Any], reason: str) -> dict[str, Any]:
    identity = raw["identity"]
    label = (
        f"{identity['dataset_id']}/{identity['release_id']}"
        if raw["kind"] == "release"
        else identity["pack_id"]
    )
    return {
        "role": raw["role"],
        "identity": label,
        "reason": reason,
        "required_for_complete_bundle": False,
    }


def _object(value: Any, context: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise DevelopmentBundleError(f"{context} must be an object")
    return value


def _exact_keys(value: dict[str, Any], expected: set[str], context: str) -> None:
    missing = sorted(expected - set(value))
    extra = sorted(set(value) - expected)
    if missing:
        raise DevelopmentBundleError(f"{context} is missing: {', '.join(missing)}")
    if extra:
        raise DevelopmentBundleError(f"{context} has unsupported fields: {', '.join(extra)}")


def _string(value: Any, context: str, pattern: re.Pattern[str] | None = None) -> str:
    if not isinstance(value, str) or not value or (pattern is not None and not pattern.fullmatch(value)):
        raise DevelopmentBundleError(f"{context} is invalid")
    return value


def _safe_relative_path(value: Any, context: str) -> str:
    text = _string(value, context)
    if "\\" in text or "\0" in text:
        raise DevelopmentBundleError(f"{context} must be a portable repository-relative path")
    path = PurePosixPath(text)
    if path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
        raise DevelopmentBundleError(f"{context} must be a bounded repository-relative path")
    return path.as_posix()


def _parse_identity(value: Any, kind: str, context: str) -> dict[str, str]:
    identity = _object(value, context)
    keys = {"dataset_id", "release_id"} if kind == "release" else {"pack_id"}
    _exact_keys(identity, keys, context)
    return {key: _string(identity[key], f"{context}.{key}", SAFE_ID) for key in sorted(keys)}


def _validate_source(value: Any, context: str) -> None:
    source = _object(value, context)
    state = source.get("state")
    if state == "unresolved":
        _exact_keys(source, {"state"}, context)
        return
    if state == "resolved":
        _exact_keys(source, {"state", "base_url"}, context)
        base_url = _string(source["base_url"], f"{context}.base_url")
        parsed = urlsplit(base_url)
        if (
            parsed.scheme != "https"
            or not parsed.netloc
            or parsed.username is not None
            or parsed.password is not None
            or parsed.query
            or parsed.fragment
            or not parsed.path.endswith("/")
            or any(
                unquote(part).lower() in {".", "..", "latest"}
                for part in PurePosixPath(parsed.path).parts
            )
        ):
            raise DevelopmentBundleError(f"{context}.base_url must be one pinned HTTPS base URL")
        return
    raise DevelopmentBundleError(f"{context}.state is unsupported: {state!r}")


def load_development_bundle(path: Path) -> dict[str, Any]:
    """Parse and structurally validate a committed bundle descriptor."""
    path = path.resolve()
    try:
        document = _object(json.loads(path.read_text()), "descriptor")
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise DevelopmentBundleError(f"cannot read development bundle descriptor {path}: {error}") from error
    _exact_keys(
        document,
        {"schema_version", "bundle_id", "provenance", "default_view", "artifacts", "unavailable"},
        "descriptor",
    )
    if document["schema_version"] != SCHEMA_VERSION:
        raise DevelopmentBundleError(
            f"unsupported development bundle schema version: {document['schema_version']!r}"
        )
    _string(document["bundle_id"], "descriptor.bundle_id", SAFE_ID)
    provenance = _object(document["provenance"], "descriptor.provenance")
    _exact_keys(
        provenance,
        {"generator", "version", "launcher_baseline_commit"},
        "descriptor.provenance",
    )
    _string(provenance["generator"], "descriptor.provenance.generator")
    _string(provenance["version"], "descriptor.provenance.version")
    _string(
        provenance["launcher_baseline_commit"],
        "descriptor.provenance.launcher_baseline_commit",
        re.compile(r"^[0-9a-f]{7,40}$"),
    )
    default_view = _object(document["default_view"], "descriptor.default_view")
    _exact_keys(
        default_view,
        {"dataset_id", "release_id", "feature_id", "parcellation_id"},
        "descriptor.default_view",
    )
    for key, value in default_view.items():
        _string(value, f"descriptor.default_view.{key}", SAFE_ID)
    artifacts = document["artifacts"]
    unavailable = document["unavailable"]
    if not isinstance(artifacts, list) or not artifacts:
        raise DevelopmentBundleError("descriptor.artifacts must be a nonempty array")
    if not isinstance(unavailable, list):
        raise DevelopmentBundleError("descriptor.unavailable must be an array")

    destinations: set[str] = set()
    identities: set[tuple[str, tuple[tuple[str, str], ...]]] = set()
    release_identities: set[tuple[str, str]] = set()
    for index, raw in enumerate(artifacts):
        context = f"descriptor.artifacts[{index}]"
        artifact = _object(raw, context)
        _exact_keys(
            artifact,
            {"role", "kind", "identity", "maturity", "destination", "root_manifest", "source", "launch_critical"},
            context,
        )
        _string(artifact["role"], f"{context}.role", SAFE_ID)
        kind = _string(artifact["kind"], f"{context}.kind")
        if kind not in KINDS:
            raise DevelopmentBundleError(f"{context}.kind is unsupported: {kind}")
        identity = _parse_identity(artifact["identity"], kind, f"{context}.identity")
        maturity = _string(artifact["maturity"], f"{context}.maturity")
        if maturity not in MATURITIES:
            raise DevelopmentBundleError(f"{context}.maturity is unsupported: {maturity}")
        destination = _safe_relative_path(artifact["destination"], f"{context}.destination")
        allowed_prefix = {
            "release": "data/releases/",
            "projection_pack": "web/public/atlas/projections/",
            "mesh_pack": "artifacts/",
        }[kind]
        if not destination.startswith(allowed_prefix):
            raise DevelopmentBundleError(f"{context}.destination must be under {allowed_prefix}")
        if destination in destinations:
            raise DevelopmentBundleError(f"duplicate development bundle destination: {destination}")
        destinations.add(destination)
        identity_key = (kind, tuple(sorted(identity.items())))
        if identity_key in identities:
            raise DevelopmentBundleError(f"duplicate development bundle identity: {identity}")
        identities.add(identity_key)
        if kind == "release":
            release_identities.add((identity["dataset_id"], identity["release_id"]))

        root = _object(artifact["root_manifest"], f"{context}.root_manifest")
        _exact_keys(root, {"path", "media_type", "bytes", "sha256"}, f"{context}.root_manifest")
        if _safe_relative_path(root["path"], f"{context}.root_manifest.path") != "manifest.json":
            raise DevelopmentBundleError(f"{context}.root_manifest.path must be manifest.json")
        if root["media_type"] != "application/json":
            raise DevelopmentBundleError(f"{context}.root_manifest.media_type must be application/json")
        if isinstance(root["bytes"], bool) or not isinstance(root["bytes"], int) or root["bytes"] <= 0:
            raise DevelopmentBundleError(f"{context}.root_manifest.bytes must be a positive integer")
        _string(root["sha256"], f"{context}.root_manifest.sha256", SHA256)
        _validate_source(artifact["source"], f"{context}.source")
        if not isinstance(artifact["launch_critical"], bool):
            raise DevelopmentBundleError(f"{context}.launch_critical must be boolean")

    default_identity = (default_view["dataset_id"], default_view["release_id"])
    if default_identity not in release_identities:
        raise DevelopmentBundleError("descriptor.default_view release is absent from artifacts")
    for index, raw in enumerate(unavailable):
        context = f"descriptor.unavailable[{index}]"
        item = _object(raw, context)
        _exact_keys(item, {"role", "identity", "reason", "required_for_complete_bundle"}, context)
        _string(item["role"], f"{context}.role", SAFE_ID)
        _string(item["identity"], f"{context}.identity")
        _string(item["reason"], f"{context}.reason")
        if not isinstance(item["required_for_complete_bundle"], bool):
            raise DevelopmentBundleError(f"{context}.required_for_complete_bundle must be boolean")
    return document
