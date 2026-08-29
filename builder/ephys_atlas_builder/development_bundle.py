"""Validate one pinned browser-ready local development corpus."""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
from typing import Any
from urllib.parse import urlsplit

from .bundle import declared_release_resource_paths
from .validate import validate_release
from tools.mesh_pack.validate import validate_pack as validate_mesh_pack
from tools.projection_pack.build import validate_projection_pack


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


def _validate_manifest_identity(document: dict[str, Any], kind: str, identity: dict[str, str]) -> None:
    if kind == "release":
        actual = (document.get("dataset_id"), document.get("release", {}).get("release_id"))
        expected = (identity["dataset_id"], identity["release_id"])
        if actual != expected:
            raise ValueError(f"release identity differs: expected {expected}, found {actual}")
    elif document.get("pack_id") != identity["pack_id"]:
        raise ValueError(
            f"pack identity differs: expected {identity['pack_id']}, found {document.get('pack_id')}"
        )


def _validate_default_view(release: Path, manifest: dict[str, Any], default_view: dict[str, str]) -> None:
    parcellation_id = default_view["parcellation_id"]
    release_parcellations = {item.get("id") for item in manifest.get("parcellations", [])}
    if parcellation_id not in release_parcellations:
        raise ValueError(f"default parcellation is absent: {parcellation_id}")
    feature_entry = next(
        (item for item in manifest.get("features", []) if item.get("id") == default_view["feature_id"]),
        None,
    )
    if feature_entry is None:
        raise ValueError(f"default feature is absent: {default_view['feature_id']}")
    descriptor = feature_entry.get("descriptor", {})
    resource = descriptor.get("resource", {})
    feature_path = release / _safe_relative_path(resource.get("path"), "default feature path")
    feature = json.loads(feature_path.read_bytes())
    regional = feature.get("representations", {}).get("regional")
    if regional is None:
        return
    parcellations = {item.get("parcellation_id") for item in regional.get("parcellations", [])}
    if parcellation_id not in parcellations:
        raise ValueError(f"default parcellation is absent from feature: {parcellation_id}")


def _validate_release_directory(release: Path, manifest: dict[str, Any]) -> list[str]:
    """Validate browser resources plus copied, hash-pinned provenance inputs."""
    declared = declared_release_resource_paths(release)
    for source in manifest.get("provenance", {}).get("sources", []):
        if (
            not isinstance(source, dict)
            or source.get("role") not in {"publication-input", "selection-freeze"}
            or "path" not in source
        ):
            continue
        relative = _safe_relative_path(source["path"], "release provenance path")
        if "sha256" not in source:
            raise ValueError(f"release provenance file has no SHA-256: {relative}")
        expected_hash = _string(source["sha256"], f"release provenance SHA-256 for {relative}", SHA256)
        target = release / relative
        encoded = target.read_bytes()
        actual_hash = hashlib.sha256(encoded).hexdigest()
        if actual_hash != expected_hash:
            raise ValueError(f"release provenance SHA-256 differs: {relative}")
        declared.add(relative)
    actual = {
        item.relative_to(release).as_posix()
        for item in release.rglob("*") if item.is_file()
    }
    missing = sorted(declared - actual)
    undeclared = sorted(actual - declared)
    if missing:
        raise ValueError(f"release graph is missing declared files: {', '.join(missing[:8])}")
    if undeclared:
        raise ValueError(f"release graph contains undeclared files: {', '.join(undeclared[:8])}")
    return sorted(actual)


def validate_development_bundle(path: Path, repository_root: Path | None = None) -> ValidatedDevelopmentBundle:
    """Verify root bytes, exact identities, and every complete artifact graph."""
    descriptor_path = path.resolve()
    document = load_development_bundle(descriptor_path)
    root = (repository_root or descriptor_path.parent.parent).resolve()
    errors: list[str] = []
    validated: list[ValidatedArtifact] = []
    for raw in document["artifacts"]:
        role = raw["role"]
        artifact_root = root / raw["destination"]
        try:
            artifact_root.resolve().relative_to(root)
            manifest_path = artifact_root / raw["root_manifest"]["path"]
            encoded = manifest_path.read_bytes()
            expected = raw["root_manifest"]
            if len(encoded) != expected["bytes"]:
                raise ValueError(
                    f"root manifest bytes differ: expected {expected['bytes']}, found {len(encoded)}"
                )
            digest = hashlib.sha256(encoded).hexdigest()
            if digest != expected["sha256"]:
                raise ValueError(
                    f"root manifest SHA-256 differs: expected {expected['sha256']}, found {digest}"
                )
            manifest = json.loads(encoded)
            _validate_manifest_identity(manifest, raw["kind"], raw["identity"])
            if raw["kind"] == "release":
                validate_release(artifact_root)
                files = _validate_release_directory(artifact_root, manifest)
                if raw["identity"] == {
                    "dataset_id": document["default_view"]["dataset_id"],
                    "release_id": document["default_view"]["release_id"],
                }:
                    _validate_default_view(artifact_root, manifest, document["default_view"])
            elif raw["kind"] == "projection_pack":
                validate_projection_pack(artifact_root)
                files = sorted(
                    item.relative_to(artifact_root).as_posix()
                    for item in artifact_root.rglob("*") if item.is_file()
                )
            else:
                validate_mesh_pack(artifact_root)
                files = sorted(
                    item.relative_to(artifact_root).as_posix()
                    for item in artifact_root.rglob("*") if item.is_file()
                )
            validated.append(
                ValidatedArtifact(
                    role=role,
                    kind=raw["kind"],
                    destination=raw["destination"],
                    identity=raw["identity"],
                    root=artifact_root,
                    file_count=len(files),
                    stored_bytes=sum((artifact_root / item).stat().st_size for item in files),
                )
            )
        except Exception as error:  # report the complete bundle rather than one artifact at a time
            errors.append(f"{role} ({raw['destination']}): {error}")
    if errors:
        raise DevelopmentBundleError(errors)
    return ValidatedDevelopmentBundle(
        descriptor_path=descriptor_path,
        bundle_id=document["bundle_id"],
        default_view=document["default_view"],
        artifacts=tuple(validated),
        unavailable=tuple(document["unavailable"]),
    )
