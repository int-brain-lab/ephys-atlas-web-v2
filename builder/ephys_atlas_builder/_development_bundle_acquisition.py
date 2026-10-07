"""Pinned HTTPS acquisition and atomic admission of bundle artifacts."""

from __future__ import annotations

import fcntl
import gzip
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import tempfile
from typing import Any, Callable
from urllib.parse import quote, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from ._development_bundle_descriptor import (
    DevelopmentBundleError,
    _safe_relative_path,
    load_development_bundle,
)
from ._development_bundle_validation import (
    ValidatedDevelopmentBundle,
    _validate_artifact,
    _validate_manifest_identity,
    validate_development_bundle,
)

FetchResource = Callable[[str, int], bytes]
FreeSpace = Callable[[Path], int]
CheckStagingParent = Callable[[], None]
MAX_PROVENANCE_INPUT_BYTES = 16 * 1024 * 1024


class _RejectRedirects(HTTPRedirectHandler):
    def redirect_request(
        self,
        request: Request,
        file_pointer: Any,
        code: int,
        message: str,
        headers: Any,
        new_url: str,
    ) -> None:
        raise ValueError(
            f"remote resource redirected away from its pinned URL: {request.full_url} -> {new_url}"
        )


_PINNED_OPENER = build_opener(_RejectRedirects())


def _open_pinned_url(request: Request) -> Any:
    return _PINNED_OPENER.open(request, timeout=60)


def _default_fetch(
    url: str,
    maximum_bytes: int,
    *,
    open_pinned_url: Callable[[Request], Any] | None = None,
) -> bytes:
    request = Request(url, headers={"Accept-Encoding": "identity"})
    opener = open_pinned_url or _open_pinned_url
    with opener(request) as response:
        final_url = response.geturl()
        if urlsplit(final_url).scheme != "https" or final_url != url:
            raise ValueError(f"remote resource redirected away from its pinned URL: {url}")
        content_length = response.headers.get("Content-Length")
        declared_length = int(content_length) if content_length is not None else None
        if declared_length is not None and declared_length > maximum_bytes:
            raise ValueError(
                f"remote resource exceeds its maximum size: {content_length} > {maximum_bytes}"
            )
        encoded = response.read(maximum_bytes + 1)
    if len(encoded) > maximum_bytes:
        raise ValueError(f"remote resource exceeds its maximum size: {maximum_bytes}")
    if declared_length is not None and len(encoded) != declared_length:
        raise ValueError(
            f"remote Content-Length differs from received bytes: {declared_length} != {len(encoded)}"
        )
    return encoded


def _resource_url(base_url: str, relative: str) -> str:
    return base_url + "/".join(quote(part, safe="") for part in PurePosixPath(relative).parts)


def _verify_resource(encoded: bytes, descriptor: dict[str, Any], relative: str) -> bytes:
    if len(encoded) != descriptor["bytes"]:
        raise ValueError(
            f"resource bytes differ for {relative}: expected {descriptor['bytes']}, found {len(encoded)}"
        )
    digest = hashlib.sha256(encoded).hexdigest()
    if digest != descriptor["sha256"]:
        raise ValueError(
            f"resource SHA-256 differs for {relative}: expected {descriptor['sha256']}, found {digest}"
        )
    codec = descriptor.get("codec")
    if not isinstance(codec, dict):
        return encoded
    if codec.get("name") == "none":
        decoded = encoded
    elif codec.get("name") == "gzip":
        decoded = gzip.decompress(encoded)
    else:
        raise ValueError(f"unsupported resource codec for {relative}: {codec.get('name')!r}")
    if len(decoded) != codec.get("decoded_bytes"):
        raise ValueError(f"decoded resource bytes differ for {relative}")
    return decoded


def _download_artifact_graph(
    staging: Path,
    raw: dict[str, Any],
    fetch: FetchResource,
    free_space: FreeSpace,
    check_staging_parent: CheckStagingParent,
) -> None:
    def preflight(required_bytes: int, relative: str) -> None:
        available = free_space(staging)
        if available < required_bytes:
            raise OSError(
                f"insufficient disk space for {relative}: need {required_bytes} bytes, "
                f"have {available} bytes"
            )

    base_url = raw["source"]["base_url"]
    root_descriptor = raw["root_manifest"]
    root_relative = root_descriptor["path"]
    preflight(root_descriptor["bytes"], root_relative)
    root_encoded = fetch(_resource_url(base_url, root_relative), root_descriptor["bytes"])
    check_staging_parent()
    root_decoded = _verify_resource(root_encoded, root_descriptor, root_relative)
    manifest = json.loads(root_decoded)
    _validate_manifest_identity(manifest, raw["kind"], raw["identity"])
    (staging / root_relative).write_bytes(root_encoded)

    feature_paths: set[str] = set()
    if raw["kind"] == "release":
        feature_paths = {
            item["descriptor"]["resource"]["path"] for item in manifest["features"]
        }
    queued: dict[str, tuple[dict[str, Any], PurePosixPath]] = {}
    downloaded = {root_relative}

    def queue_document(document: Any, resource_base: PurePosixPath) -> None:
        if isinstance(document, list):
            for item in document:
                queue_document(item, resource_base)
            return
        if not isinstance(document, dict):
            return
        if {"path", "bytes", "sha256", "codec"}.issubset(document):
            relative = _safe_relative_path(
                (resource_base / _safe_relative_path(document["path"], "resource path")).as_posix(),
                "resource path",
            )
            previous = queued.get(relative)
            if previous is not None and previous[0] != document:
                raise ValueError(f"conflicting resource declarations for {relative}")
            next_base = (
                PurePosixPath(relative).parent
                if relative in feature_paths else resource_base
            )
            queued[relative] = (document, next_base)
        for item in document.values():
            queue_document(item, resource_base)

    queue_document(manifest, PurePosixPath("."))
    while True:
        pending = sorted(set(queued) - downloaded)
        if not pending:
            break
        preflight(
            sum(queued[path][0]["bytes"] for path in pending),
            "currently declared resource graph",
        )
        relative = pending[0]
        descriptor, next_base = queued[relative]
        encoded = fetch(_resource_url(base_url, relative), descriptor["bytes"])
        check_staging_parent()
        decoded = _verify_resource(encoded, descriptor, relative)
        target = staging / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(encoded)
        downloaded.add(relative)
        if descriptor.get("media_type") == "application/json":
            queue_document(json.loads(decoded), next_base)

    if raw["kind"] == "release":
        provenance_sources = [
            source
            for source in manifest.get("provenance", {}).get("sources", [])
            if isinstance(source, dict)
            and source.get("role") in {"publication-input", "selection-freeze"}
            and "path" in source
        ]
        pending_provenance = {
            _safe_relative_path(source["path"], "release provenance path")
            for source in provenance_sources
        } - downloaded
        if pending_provenance:
            preflight(
                len(pending_provenance) * MAX_PROVENANCE_INPUT_BYTES,
                "release provenance graph",
            )
        for source in provenance_sources:
            relative = _safe_relative_path(source["path"], "release provenance path")
            if relative in downloaded:
                continue
            encoded = fetch(_resource_url(base_url, relative), MAX_PROVENANCE_INPUT_BYTES)
            check_staging_parent()
            digest = hashlib.sha256(encoded).hexdigest()
            if digest != source.get("sha256"):
                raise ValueError(f"release provenance SHA-256 differs: {relative}")
            target = staging / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(encoded)
            downloaded.add(relative)


def sync_development_bundle(
    path: Path,
    repository_root: Path | None = None,
    fetch: FetchResource | None = None,
    free_space: FreeSpace | None = None,
) -> ValidatedDevelopmentBundle:
    """Fetch absent resolved artifacts atomically, then validate the complete bundle."""
    descriptor_path = path.resolve()
    document = load_development_bundle(descriptor_path)
    root = (repository_root or descriptor_path.parent.parent).resolve()
    transport = fetch or _default_fetch
    available_space = free_space or (lambda location: shutil.disk_usage(location).free)
    errors: list[str] = []
    for raw in document["artifacts"]:
        role = raw["role"]
        destination = root / raw["destination"]
        destination_parent = destination.parent.absolute()
        try:
            resolved_parent = destination.parent.resolve()
            resolved_parent.relative_to(root)
            if resolved_parent != destination_parent:
                raise ValueError("destination parent contains a symbolic link")
        except ValueError:
            errors.append(
                f"{role} ({raw['destination']}): destination parent escapes the repository root"
            )
            continue
        if os.path.lexists(destination):
            try:
                if destination.is_symlink():
                    raise ValueError("destination is a symbolic link")
                destination.resolve().relative_to(root)
                _validate_artifact(raw, document, destination)
            except Exception as error:
                errors.append(
                    f"{role} ({raw['destination']}): existing destination is invalid and was not "
                    f"overwritten; move or remove it explicitly, then retry: {error}"
                )
            continue
        if raw["source"]["state"] != "resolved":
            if not raw["launch_critical"]:
                continue
            errors.append(
                f"{role} ({raw['destination']}): artifact is missing and has no resolved immutable "
                "HTTPS source; obtain it manually or use a descriptor with a pinned base_url"
            )
            continue
        staging: Path | None = None
        check_staging_parent: CheckStagingParent | None = None
        parent_fd: int | None = None
        lock_fd: int | None = None
        admitted = False
        try:
            destination.parent.mkdir(parents=True, exist_ok=True)
            parent_fd = os.open(
                destination.parent,
                os.O_RDONLY | getattr(os, "O_DIRECTORY", 0),
            )
            parent_stat = os.fstat(parent_fd)
            parent_identity = (parent_stat.st_dev, parent_stat.st_ino)
            lock_directory = root / "artifacts/.development-bundle-locks"
            lock_directory.mkdir(parents=True, exist_ok=True)
            lock_name = hashlib.sha256(raw["destination"].encode()).hexdigest()
            lock_fd = os.open(
                lock_directory / f"{lock_name}.lock",
                os.O_CREAT | os.O_RDWR,
                0o600,
            )
            try:
                fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as error:
                raise FileExistsError(
                    "another development-bundle sync owns this destination"
                ) from error

            def assert_staging_parent() -> None:
                current = os.stat(destination.parent, follow_symlinks=False)
                if (
                    destination.parent.is_symlink()
                    or destination.parent.resolve() != destination_parent
                    or (current.st_dev, current.st_ino) != parent_identity
                ):
                    raise ValueError("destination parent changed during synchronization")

            check_staging_parent = assert_staging_parent
            staging = Path(tempfile.mkdtemp(
                prefix=f".{destination.name}.bundle-stage-", dir=destination.parent
            ))
            assert_staging_parent()
            _download_artifact_graph(
                staging,
                raw,
                transport,
                available_space,
                assert_staging_parent,
            )
            _validate_artifact(raw, document, staging)
            assert_staging_parent()
            try:
                os.stat(destination.name, dir_fd=parent_fd, follow_symlinks=False)
            except FileNotFoundError:
                pass
            else:
                raise FileExistsError(
                    "destination appeared while downloading; refusing to replace it"
                )
            os.replace(
                staging.name,
                destination.name,
                src_dir_fd=parent_fd,
                dst_dir_fd=parent_fd,
            )
            admitted = True
        except Exception as error:
            if raw["launch_critical"]:
                errors.append(f"{role} ({raw['destination']}): download failed: {error}")
        finally:
            if staging is not None and not admitted:
                if parent_fd is not None:
                    shutil.rmtree(staging.name, dir_fd=parent_fd, ignore_errors=True)
                else:
                    shutil.rmtree(staging, ignore_errors=True)
            if lock_fd is not None:
                fcntl.flock(lock_fd, fcntl.LOCK_UN)
                os.close(lock_fd)
            if parent_fd is not None:
                os.close(parent_fd)
    if errors:
        raise DevelopmentBundleError(errors)
    return validate_development_bundle(descriptor_path, root)
