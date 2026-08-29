"""Synchronize and validate one pinned browser-ready development corpus."""

from __future__ import annotations

from dataclasses import dataclass
import fcntl
import gzip
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import tempfile
from typing import Any, Callable
from urllib.parse import quote, unquote, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from .bundle import declared_release_resource_paths
from .validate import validate_release
from tools.mesh_pack.validate import validate_pack as validate_mesh_pack
from tools.projection_pack.build import validate_projection_pack


SCHEMA_VERSION = "1.0"
KINDS = {"release", "projection_pack", "mesh_pack"}
MATURITIES = {"validated-real-local", "production-intent", "staging", "published-production"}
SHA256 = re.compile(r"^[0-9a-f]{64}$")
SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
MAX_PROVENANCE_INPUT_BYTES = 16 * 1024 * 1024

FetchResource = Callable[[str, int], bytes]
FreeSpace = Callable[[Path], int]
CheckStagingParent = Callable[[], None]


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


def _default_fetch(url: str, maximum_bytes: int) -> bytes:
    request = Request(url, headers={"Accept-Encoding": "identity"})
    with _open_pinned_url(request) as response:
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
