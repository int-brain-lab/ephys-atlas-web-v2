"""Validation of staged release, projection, and mesh artifact graphs."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from typing import Any

from ._development_bundle_descriptor import (
    DevelopmentBundleError,
    SHA256,
    ValidatedArtifact,
    ValidatedDevelopmentBundle,
    _runtime_unavailable,
    _safe_relative_path,
    _string,
    load_development_bundle,
)
from .bundle import declared_release_resource_paths
from .validate import validate_release
from tools.mesh_pack.validate import validate_pack as validate_mesh_pack
from tools.projection_pack.build import validate_projection_pack

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


def _validate_artifact(
    raw: dict[str, Any],
    document: dict[str, Any],
    artifact_root: Path,
) -> ValidatedArtifact:
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
    return ValidatedArtifact(
        role=raw["role"],
        kind=raw["kind"],
        destination=raw["destination"],
        identity=raw["identity"],
        root=artifact_root,
        file_count=len(files),
        stored_bytes=sum((artifact_root / item).stat().st_size for item in files),
    )


def validate_development_bundle(path: Path, repository_root: Path | None = None) -> ValidatedDevelopmentBundle:
    """Verify root bytes, exact identities, and every complete artifact graph."""
    descriptor_path = path.resolve()
    document = load_development_bundle(descriptor_path)
    root = (repository_root or descriptor_path.parent.parent).resolve()
    errors: list[str] = []
    validated: list[ValidatedArtifact] = []
    unavailable = list(document["unavailable"])
    for raw in document["artifacts"]:
        role = raw["role"]
        artifact_root = root / raw["destination"]
        if not os.path.lexists(artifact_root) and not raw["launch_critical"]:
            unavailable.append(_runtime_unavailable(
                raw,
                "Optional artifact is not present locally; no fallback was selected.",
            ))
            continue
        try:
            artifact_root.resolve().relative_to(root)
            validated.append(_validate_artifact(raw, document, artifact_root))
        except Exception as error:  # report the complete bundle rather than one artifact at a time
            errors.append(f"{role} ({raw['destination']}): {error}")
    if errors:
        raise DevelopmentBundleError(errors)
    return ValidatedDevelopmentBundle(
        descriptor_path=descriptor_path,
        bundle_id=document["bundle_id"],
        default_view=document["default_view"],
        artifacts=tuple(validated),
        unavailable=tuple(unavailable),
    )
