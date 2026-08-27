"""Build one immutable five-view projection pack from validated inputs."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import html
import json
import re
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from jsonschema import Draft202012Validator

from ephys_atlas_builder.schema_v1 import validate_schema_v1_document
from tools.svg_pack import decode

PROJECTIONS = ("coronal", "sagittal", "horizontal")
STATIC_PROJECTIONS = ("top", "swanson")
StaticSourceMode = Literal["pinned-curated", "synthetic-fixture", "pinned-top-review"]
REFERENCE_SPACE_ID = "allen-ccf-2017"
GRID_ID = "allen-ccf-2017-10um"
VIEW_BOX = [60, 20, 340, 300]
STATIC_LICENSE_RELATIVE_PATH = Path("LICENSES/IBL-EPHYS-ATLAS-V1-STATIC-ASSETS-MIT.txt")
STATIC_LICENSE_SHA256 = (
    "f31adf14af0265cae0f866a515bda9b0750f7473d40cef5598c7f4305037ce37"
)
STATIC_LICENSE_EVIDENCE = (
    f"MIT; repository-file={STATIC_LICENSE_RELATIVE_PATH.as_posix()};"
    f"sha256={STATIC_LICENSE_SHA256}"
)


@dataclass(frozen=True)
class PinnedStaticSource:
    bytes: int
    sha256: str
    path_count: int


PINNED_STATIC_SOURCES = {
    "top": PinnedStaticSource(
        40_173,
        "4dc788df3da667c8dde5a9f1b0abc258715a916cb8609542bdd849f793815c30",
        114,
    ),
    "swanson": PinnedStaticSource(
        192_565,
        "347ad18c2eb0fad1012d30432ff4abf8a09dc0acc0f33b57efbdd2790826acba",
        808,
    ),
}

_TAG = re.compile(r"<path\b(?P<attributes>[^<>]*?)/?>", re.IGNORECASE)
_ATTRIBUTE = re.compile(
    r"(?P<name>[A-Za-z_:][A-Za-z0-9_.:-]*)\s*=\s*(?P<quote>['\"])(?P<value>.*?)(?P=quote)",
    re.DOTALL,
)
_PATH_DATA = re.compile(r"[MmZzLlHhVvCcSsQqTtAaEe0-9,.+\-\s]+")
_NORMALIZED_PATH = re.compile(
    r'<path class="atlas-region" fill-rule="evenodd" '
    r'data-allen-id="(?P<allen>-?\d+)" data-beryl-id="(?P<beryl>-?\d+)" '
    r'data-cosmos-id="(?P<cosmos>-?\d+)" d="(?P<d>[MmZzLlHhVvCcSsQqTtAaEe0-9,.+\-\s]+)"/>'
)


def _canonical(value: Any) -> bytes:
    return json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _safe_relative(value: str) -> Path:
    path = Path(value)
    if (
        path.is_absolute()
        or ".." in path.parts
        or not path.parts
        or any(not part for part in path.parts)
    ):
        raise ValueError(f"unsafe projection-pack path: {value!r}")
    return path


def _resource(
    path: Path, encoded: bytes, decoded_bytes: int, media_type: str
) -> dict[str, Any]:
    return {
        "path": path.as_posix(),
        "media_type": media_type,
        "bytes": len(encoded),
        "sha256": _sha(encoded),
        "codec": {"name": "gzip", "decoded_bytes": decoded_bytes, "level": 9},
    }


def _plain_resource(path: Path, content: bytes, media_type: str) -> dict[str, Any]:
    return {
        "path": path.as_posix(),
        "media_type": media_type,
        "bytes": len(content),
        "sha256": _sha(content),
        "codec": {"name": "none", "decoded_bytes": len(content)},
    }


def _read_resource(root: Path, resource: dict[str, Any]) -> tuple[bytes, bytes]:
    path = _safe_relative(resource["path"])
    try:
        encoded = (root / path).read_bytes()
    except FileNotFoundError as exc:
        raise ValueError(f"projection-pack resource is missing: {path}") from exc
    if len(encoded) != resource["bytes"] or _sha(encoded) != resource["sha256"]:
        raise ValueError(f"projection-pack resource integrity mismatch: {path}")
    codec = resource["codec"]
    if codec["name"] == "none":
        decoded_bytes = encoded
    elif codec["name"] == "gzip":
        try:
            decoded_bytes = gzip.decompress(encoded)
        except (gzip.BadGzipFile, EOFError) as exc:
            raise ValueError(
                f"projection-pack resource is not valid gzip: {path}"
            ) from exc
    else:
        raise ValueError(f"projection-pack resource has unsupported codec: {path}")
    if len(decoded_bytes) != codec["decoded_bytes"]:
        raise ValueError(f"projection-pack decoded length mismatch: {path}")
    return encoded, decoded_bytes


def _validated_static_license_notice() -> bytes:
    repository = Path(__file__).resolve().parents[2]
    try:
        notice = (repository / STATIC_LICENSE_RELATIVE_PATH).read_bytes()
    except FileNotFoundError as exc:
        raise ValueError("production Top/Swanson license evidence is missing") from exc
    if _sha(notice) != STATIC_LICENSE_SHA256:
        raise ValueError(
            "production Top/Swanson license evidence differs from authorization"
        )
    return notice


def _extent(matrix: list[float], shape: list[int]) -> list[float]:
    result: list[float] = []
    for world_row in range(3):
        columns = [column for column in range(3) if matrix[world_row * 4 + column] != 0]
        if len(columns) != 1:
            raise ValueError("registered projection affine is not a signed permutation")
        column = columns[0]
        scale = float(matrix[world_row * 4 + column])
        translation = float(matrix[world_row * 4 + 3])
        edges = (translation - scale * 0.5, translation + scale * (shape[column] - 0.5))
        result.extend((min(edges), max(edges)))
    return result


def _inverse(matrix: list[float]) -> list[float]:
    result = [0.0] * 16
    result[15] = 1.0
    for world_row in range(3):
        columns = [column for column in range(3) if matrix[world_row * 4 + column] != 0]
        if len(columns) != 1:
            raise ValueError("registered projection affine is not a signed permutation")
        column = columns[0]
        scale = float(matrix[world_row * 4 + column])
        translation = float(matrix[world_row * 4 + 3])
        result[column * 4 + world_row] = 1.0 / scale
        result[column * 4 + 3] = -translation / scale
    return result


def _validate_registered_parent(manifest: dict[str, Any]) -> None:
    if (
        manifest.get("format") != "anatomy-pack-v3"
        or manifest.get("immutable") is not True
    ):
        raise ValueError("registered parent must be one immutable anatomy-pack-v3")
    schema = json.loads(
        (
            Path(__file__).resolve().parents[2]
            / "schema/anatomy-pack-v3/manifest.schema.json"
        ).read_text()
    )
    Draft202012Validator(schema).validate(manifest)
    parent = manifest.get("parent")
    if not isinstance(parent, dict) or parent.get("format") != "anatomy-pack-v2":
        raise ValueError("registered parent must retain its anatomy-pack-v2 authority")
    validation = parent.get("validation")
    if not isinstance(validation, dict):
        raise ValueError("registered parent has no scientific validation evidence")
    required = {
        "topology_valid": True,
        "coverage_valid": True,
        "background_topology_valid": True,
        "adjacency_mismatches": 0,
        "invalid_geometries": 0,
        "missing_atlas_ids": [],
        "multiply_covered_voxels": 0,
        "uncovered_voxels": 0,
        "sentinel_max_error_um": 0,
    }
    for key, expected in required.items():
        if validation.get(key) != expected:
            raise ValueError(f"registered parent failed scientific gate {key}")
    source = parent.get("source")
    if (
        not isinstance(source, dict)
        or source.get("hemisphere") != "bilateral"
        or source.get("resolution_um") != 10
    ):
        raise ValueError("registered parent is not the bilateral 10 um authority")
    region_ids = source.get("region_ids")
    if (
        not isinstance(region_ids, dict)
        or region_ids.get("domain") != "signed_allen_atlas_id"
    ):
        raise ValueError("registered parent does not carry signed Allen identities")
    if len(parent.get("synchronization_sentinels") or []) < 2:
        raise ValueError("registered parent lacks synchronization evidence")


def _copy_registered_projection(
    source_root: Path,
    stage: Path,
    projection_id: str,
    projection: dict[str, Any],
    *,
    reference_space_id: str,
    grid_id: str,
) -> dict[str, Any]:
    pack_sets = projection["pack_sets"]
    if len(pack_sets) != 1:
        raise ValueError(f"{projection_id} must expose exactly one sparse pack set")
    pack_set = next(iter(pack_sets.values()))
    entries: list[dict[str, Any]] = []
    all_slices: list[int] = []
    for artifact in sorted(pack_set["packs"], key=lambda item: item["pack_index"]):
        source_path = _safe_relative(artifact["path"])
        encoded = (source_root / source_path).read_bytes()
        if len(encoded) != artifact["bytes"] or _sha(encoded) != artifact["sha256"]:
            raise ValueError(f"registered source integrity mismatch: {source_path}")
        try:
            decoded_bytes = gzip.decompress(encoded)
        except (gzip.BadGzipFile, EOFError) as exc:
            raise ValueError(
                f"registered source is not valid gzip: {source_path}"
            ) from exc
        if len(decoded_bytes) != artifact["uncompressed_bytes"]:
            raise ValueError(
                f"registered source decoded length mismatch: {source_path}"
            )
        pack = decode(decoded_bytes)
        if pack.projection != projection_id or pack.pack_id != artifact["pack_id"]:
            raise ValueError(f"registered source pack identity mismatch: {source_path}")
        slice_indices = [fragment.slice_index for fragment in pack.fragments]
        if (
            len(slice_indices) != artifact["slice_count"]
            or slice_indices[0] != artifact["first_slice_index"]
        ):
            raise ValueError(f"registered source inventory mismatch: {source_path}")
        destination = (
            Path("registered") / projection_id / f"{artifact['pack_index']}.isvg.gz"
        )
        target = stage / destination
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(encoded)
        entries.append(
            {
                "pack_id": artifact["pack_id"],
                "slice_indices": slice_indices,
                "resource": _resource(
                    destination,
                    encoded,
                    len(decoded_bytes),
                    "application/vnd.ibl.indexed-svg",
                ),
            }
        )
        all_slices.extend(slice_indices)
    if all_slices != projection["display_slice_indices"]:
        raise ValueError(
            f"registered {projection_id} resources do not cover the declared display inventory"
        )

    index = {
        "schema_version": "1.0",
        "format": "atlas-registered-svg-resource-index-v1",
        "projection_id": projection_id,
        "resources": entries,
    }
    validate_schema_v1_document(index, "registered-svg-resource-index.schema.json")
    index_raw = _canonical(index)
    index_encoded = gzip.compress(index_raw, compresslevel=9, mtime=0)
    index_path = Path("registered") / projection_id / "resources.json.gz"
    (stage / index_path).write_bytes(index_encoded)

    # anatomy-pack-v3 inherited height/width array order; v1 affine shape is
    # explicitly [slice,u,v], matching the view-box x/y plane axes.
    slice_shape = list(reversed(projection["slice_shape"]))
    matrix = list(projection["plane_index_to_world_um"])
    result = {
        "id": projection_id,
        "kind": "registered-slice-stack",
        "reference_space_id": reference_space_id,
        "grid_id": grid_id,
        "world_slice_axis": projection["fixed_world_axis"],
        "slice_count": projection["slice_count"],
        "slice_shape": slice_shape,
        "view_box": projection["view_box"],
        "plane_index_to_world_um": matrix,
        "world_to_plane_index": _inverse(matrix),
        "voxel_edge_extent_um": _extent(
            matrix, [projection["slice_count"], *slice_shape]
        ),
        "display_slices": all_slices,
        "resource_index": {
            "format": "atlas-registered-svg-resource-index-v1",
            "resource": _resource(
                index_path, index_encoded, len(index_raw), "application/json"
            ),
        },
    }
    validate_schema_v1_document(result, "registered-projection.schema.json")
    return result


def _crosswalk(catalog_path: Path) -> tuple[dict[str, dict[int, int]], str]:
    raw = catalog_path.read_bytes()
    document = json.loads(raw)
    if (
        document.get("format") != "ibl-atlas-regions-v1"
        or document.get("schema_version") != "1.0"
    ):
        raise ValueError("region crosswalk must be the pinned atlas-region catalog")
    mappings = document.get("mappings")
    if not isinstance(mappings, dict):
        raise ValueError("region crosswalk has no mappings")
    for mapping in ("allen", "beryl", "cosmos"):
        rows = mappings.get(mapping)
        if not isinstance(rows, list):
            raise ValueError(f"region crosswalk has no {mapping} mapping")
    result: dict[str, dict[int, int]] = {
        mapping: {} for mapping in ("allen", "beryl", "cosmos")
    }
    for row in mappings["allen"]:
        index = row.get("idx")
        mapped_atlas_ids = row.get("mapped_atlas_ids")
        if not isinstance(index, int) or not isinstance(mapped_atlas_ids, dict):
            raise ValueError("region crosswalk has invalid BrainRegions identities")
        if set(mapped_atlas_ids) != set(result):
            raise ValueError("region crosswalk has incomplete mapped identities")
        for mapping, lookup in result.items():
            atlas_id = mapped_atlas_ids[mapping]
            if not isinstance(atlas_id, int):
                raise ValueError("region crosswalk has invalid mapped identities")
            if atlas_id == 0:
                continue
            if index in lookup:
                raise ValueError(
                    f"region crosswalk has duplicate {mapping} BrainRegions identities"
                )
            lookup[index] = atlas_id
    return result, _sha(raw)


def _attributes(raw: str) -> dict[str, str]:
    result: dict[str, str] = {}
    cursor = 0
    for match in _ATTRIBUTE.finditer(raw):
        if raw[cursor : match.start()].strip():
            raise ValueError("static SVG path has malformed attributes")
        name = match.group("name").lower()
        if name in result:
            raise ValueError(f"static SVG path repeats attribute {name}")
        result[name] = match.group("value")
        cursor = match.end()
    if raw[cursor:].strip(" /\t\r\n"):
        raise ValueError("static SVG path has malformed trailing attributes")
    return result


def normalize_static_fragment(
    fragment: str, crosswalk: dict[str, dict[int, int]]
) -> tuple[str, int]:
    output: list[str] = []
    cursor = 0
    for match in _TAG.finditer(fragment):
        if fragment[cursor : match.start()].strip():
            raise ValueError("static SVG fragment contains content other than paths")
        attributes = _attributes(match.group("attributes"))
        classes = attributes.get("class", "").split()
        data = attributes.get("d")
        if not data or _PATH_DATA.fullmatch(data) is None:
            raise ValueError("static SVG path has missing or unsafe path data")
        ids: dict[str, int] = {}
        for mapping in ("allen", "beryl", "cosmos"):
            matches = [
                value for value in classes if value.startswith(f"{mapping}_region_")
            ]
            if len(matches) != 1:
                raise ValueError(
                    f"static SVG path must declare one {mapping} legacy identity"
                )
            suffix = matches[0].removeprefix(f"{mapping}_region_")
            if not re.fullmatch(r"-?\d+", suffix):
                raise ValueError(
                    f"static SVG path has malformed {mapping} legacy identity"
                )
            legacy_index = int(suffix)
            if legacy_index not in crosswalk[mapping]:
                raise ValueError(
                    f"static SVG path has unknown {mapping} legacy identity {legacy_index}"
                )
            ids[mapping] = crosswalk[mapping][legacy_index]
        output.append(
            '<path class="atlas-region" fill-rule="evenodd" '
            f'data-allen-id="{ids["allen"]}" data-beryl-id="{ids["beryl"]}" '
            f'data-cosmos-id="{ids["cosmos"]}" d="{html.escape(data, quote=True)}"/>'
        )
        cursor = match.end()
    if fragment[cursor:].strip() or not output:
        raise ValueError("static SVG fragment contains unsupported markup or no paths")
    return "".join(output), len(output)


def _validate_normalized_static_fragment(
    fragment: str, expected_path_count: int
) -> None:
    cursor = 0
    path_count = 0
    for match in _NORMALIZED_PATH.finditer(fragment):
        if match.start() != cursor:
            raise ValueError("static projection contains non-canonical SVG markup")
        if any(
            int(match.group(mapping)) == 0 for mapping in ("allen", "beryl", "cosmos")
        ):
            raise ValueError(
                "static projection contains the reserved zero region identity"
            )
        cursor = match.end()
        path_count += 1
    if cursor != len(fragment) or path_count != expected_path_count:
        raise ValueError(
            "static projection path inventory does not match its descriptor"
        )


def validate_projection_pack(root: Path) -> dict[str, Any]:
    """Validate one complete, self-contained projection-pack directory."""
    root = root.resolve()
    try:
        manifest = json.loads((root / "manifest.json").read_bytes())
    except FileNotFoundError as exc:
        raise ValueError("projection pack has no manifest.json") from exc
    validate_schema_v1_document(manifest, "projection-pack.schema.json")

    declared = {Path("manifest.json")}
    for projection in manifest["projections"]:
        projection_id = projection["id"]
        if projection["kind"] == "static-regional-map":
            resource = projection["fragment"]["resource"]
            _, decoded_bytes = _read_resource(root, resource)
            declared.add(_safe_relative(resource["path"]))
            try:
                fragment = decoded_bytes.decode("utf-8", "strict")
            except UnicodeDecodeError as exc:
                raise ValueError(
                    f"static projection {projection_id} is not UTF-8"
                ) from exc
            _validate_normalized_static_fragment(fragment, projection["path_count"])
            continue

        index_resource = projection["resource_index"]["resource"]
        _, index_bytes = _read_resource(root, index_resource)
        declared.add(_safe_relative(index_resource["path"]))
        try:
            index = json.loads(index_bytes)
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError(
                f"registered projection {projection_id} has an invalid resource index"
            ) from exc
        validate_schema_v1_document(index, "registered-svg-resource-index.schema.json")
        if index["projection_id"] != projection_id:
            raise ValueError(
                f"registered projection {projection_id} resource index identity differs"
            )
        indexed_slices: list[int] = []
        for entry in index["resources"]:
            resource = entry["resource"]
            _, decoded_bytes = _read_resource(root, resource)
            declared.add(_safe_relative(resource["path"]))
            try:
                pack = decode(decoded_bytes)
            except ValueError as exc:
                raise ValueError(
                    f"registered projection {projection_id} contains invalid indexed SVG"
                ) from exc
            slices = [fragment.slice_index for fragment in pack.fragments]
            if pack.projection != projection_id or pack.pack_id != entry["pack_id"]:
                raise ValueError(
                    f"registered projection {projection_id} pack identity differs"
                )
            if slices != entry["slice_indices"]:
                raise ValueError(
                    f"registered projection {projection_id} pack inventory differs"
                )
            indexed_slices.extend(slices)
        if indexed_slices != projection["display_slices"]:
            raise ValueError(
                f"registered projection {projection_id} display inventory differs"
            )

    recipe = manifest["provenance"]["recipe"]
    if recipe.get("static_source_mode") == "pinned-curated":
        notice = recipe.get("license_notice")
        if (
            not isinstance(notice, dict)
            or notice.get("format") != "ibl-static-asset-license-v1"
        ):
            raise ValueError(
                "production projection pack has no static-asset license notice"
            )
        resource = notice.get("resource")
        if not isinstance(resource, dict):
            raise ValueError(
                "production projection pack has invalid static-asset license notice"
            )
        _, notice_bytes = _read_resource(root, resource)
        declared.add(_safe_relative(resource["path"]))
        if (
            resource["path"] != STATIC_LICENSE_RELATIVE_PATH.as_posix()
            or _sha(notice_bytes) != STATIC_LICENSE_SHA256
        ):
            raise ValueError(
                "production projection pack license notice differs from authorization"
            )

    actual = {path.relative_to(root) for path in root.rglob("*") if path.is_file()}
    if actual != declared:
        missing = sorted(path.as_posix() for path in declared - actual)
        extra = sorted(path.as_posix() for path in actual - declared)
        raise ValueError(
            f"projection pack file graph differs: missing={missing}, extra={extra}"
        )
    return manifest


def _static_projection(
    stage: Path,
    projection_id: str,
    source_path: Path,
    source_evidence: PinnedStaticSource,
    crosswalk: dict[str, dict[int, int]],
) -> tuple[dict[str, Any], str]:
    source = source_path.read_bytes()
    if len(source) != source_evidence.bytes or _sha(source) != source_evidence.sha256:
        raise ValueError(f"{projection_id} source bytes do not match pinned evidence")
    payload = json.loads(source)
    if (
        not isinstance(payload, dict)
        or set(payload) != {"0"}
        or not isinstance(payload["0"], str)
    ):
        raise ValueError(f"{projection_id} source must contain exactly static key 0")
    normalized, path_count = normalize_static_fragment(payload["0"], crosswalk)
    if path_count != source_evidence.path_count:
        raise ValueError(
            f"{projection_id} source path count does not match pinned evidence"
        )
    decoded = normalized.encode("utf-8", "strict")
    encoded = gzip.compress(decoded, compresslevel=9, mtime=0)
    # `.isvg.gz` is intentionally transport-opaque. Development/static hosts
    # must not infer HTTP Content-Encoding and transparently alter the bytes
    # before the runtime verifies their declared encoded SHA-256.
    path = Path("static") / f"{projection_id}.isvg.gz"
    target = stage / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(encoded)
    projection = {
        "id": projection_id,
        "kind": "static-regional-map",
        "view_box": VIEW_BOX,
        "path_count": path_count,
        "fragment": {
            "format": "ibl-regional-svg-fragment-v1",
            "encoding": "utf-8",
            "resource": _resource(path, encoded, len(decoded), "image/svg+xml"),
        },
    }
    validate_schema_v1_document(projection, "static-projection.schema.json")
    return projection, _sha(source)


def build_projection_pack(
    registered_root: Path,
    region_catalog_path: Path,
    static_sources: dict[str, Path],
    output: Path,
    *,
    created_at: str,
    generator_commit: str,
    reference_space_id: str = REFERENCE_SPACE_ID,
    grid_id: str = GRID_ID,
    static_mode: StaticSourceMode = "pinned-curated",
    license_evidence: str | None = None,
) -> dict[str, Any]:
    if output.exists():
        raise FileExistsError(f"refusing to overwrite projection pack: {output}")
    if set(static_sources) != set(STATIC_PROJECTIONS):
        raise ValueError("static sources must contain exactly top and swanson")
    if static_mode not in ("pinned-curated", "synthetic-fixture", "pinned-top-review"):
        raise ValueError(f"unsupported static source mode {static_mode!r}")
    license_notice: bytes | None = None
    if static_mode == "pinned-curated":
        license_notice = _validated_static_license_notice()
        if license_evidence not in (None, STATIC_LICENSE_EVIDENCE):
            raise ValueError(
                "production Top/Swanson license evidence is not the authorized record"
            )
        license_evidence = STATIC_LICENSE_EVIDENCE

    registered_root = registered_root.resolve()
    manifest_path = registered_root / "manifest.json"
    manifest_raw = manifest_path.read_bytes()
    registered_manifest = json.loads(manifest_raw)
    _validate_registered_parent(registered_manifest)
    crosswalk, crosswalk_sha = _crosswalk(region_catalog_path)

    static_projection_modes = {
        name: (
            "pinned-curated"
            if static_mode == "pinned-curated"
            else "pinned-review"
            if static_mode == "pinned-top-review" and name == "top"
            else "synthetic-fixture"
        )
        for name in STATIC_PROJECTIONS
    }
    evidence = {
        name: (
            PINNED_STATIC_SOURCES[name]
            if static_projection_modes[name] != "synthetic-fixture"
            else PinnedStaticSource(
                static_sources[name].stat().st_size,
                _sha(static_sources[name].read_bytes()),
                PINNED_STATIC_SOURCES[name].path_count,
            )
        )
        for name in STATIC_PROJECTIONS
    }

    stage_parent = output.parent
    stage_parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(
        prefix=f".{output.name}-", dir=stage_parent
    ) as temporary:
        stage = Path(temporary)
        if license_notice is not None:
            license_target = stage / STATIC_LICENSE_RELATIVE_PATH
            license_target.parent.mkdir(parents=True, exist_ok=True)
            license_target.write_bytes(license_notice)
        registered = [
            _copy_registered_projection(
                registered_root,
                stage,
                name,
                registered_manifest["projections"][name],
                reference_space_id=reference_space_id,
                grid_id=grid_id,
            )
            for name in PROJECTIONS
        ]
        static_results = [
            _static_projection(
                stage, name, static_sources[name], evidence[name], crosswalk
            )
            for name in STATIC_PROJECTIONS
        ]
        static = [result[0] for result in static_results]
        static_hashes = {
            name: result[1] for name, result in zip(STATIC_PROJECTIONS, static_results)
        }
        identity = {
            "format": "atlas-projection-pack-v1",
            "registered_manifest_sha256": _sha(manifest_raw),
            "crosswalk_sha256": crosswalk_sha,
            "static_source_sha256": static_hashes,
            "reference_space_id": reference_space_id,
            "grid_id": grid_id,
            "generator_commit": generator_commit,
            "created_at": created_at,
            "static_source_mode": static_mode,
            "static_projection_modes": static_projection_modes,
            "license_evidence": license_evidence,
        }
        prefix = {
            "synthetic-fixture": "synthetic-atlas-projections",
            "pinned-top-review": "review-atlas-projections",
            "pinned-curated": "ibl-atlas-projections",
        }[static_mode]
        pack_id = f"{prefix}-{_sha(_canonical(identity))[:12]}"
        sources: list[dict[str, Any]] = [
            {
                "role": "atlas-geometry",
                "description": "Validated bilateral 10 um sparse registered anatomy pack",
                "path": "registered-parent/manifest.json",
                "sha256": _sha(manifest_raw),
            },
            {
                "role": "atlas-geometry",
                "description": "Pinned Allen/Beryl/Cosmos legacy-index crosswalk",
                "path": "atlas/allen-ccf-2017/regions.json",
                "sha256": crosswalk_sha,
            },
        ]
        for name in STATIC_PROJECTIONS:
            projection_mode = static_projection_modes[name]
            source_description = {
                "pinned-curated": "Pinned curated",
                "pinned-review": "Pinned local-review-only",
                "synthetic-fixture": "Synthetic fixture",
            }[projection_mode]
            source: dict[str, Any] = {
                "role": "atlas-geometry"
                if projection_mode == "pinned-curated"
                else "user-input",
                "description": f"{source_description} {name} SVG fragment",
                "path": f"legacy/slices_{name}.json",
                "sha256": static_hashes[name],
            }
            if projection_mode in ("pinned-curated", "pinned-review"):
                source.update(
                    repository="int-brain-lab/ephys-atlas-web",
                    commit="1d908bea095be2616a750d939d143f3b4db2a641",
                )
            if projection_mode == "pinned-curated":
                source["license"] = license_evidence
            sources.append(source)
        provenance = {
            "sources": sources,
            "builder": {
                "name": "ephys-atlas-projection-pack",
                "version": "1",
                "repository": "rossant/ibl-ephys-atlas-web-v2",
                "commit": generator_commit,
                "command": (
                    "python -m tools.projection_pack.build_top_review"
                    if static_mode == "pinned-top-review"
                    else "python -m tools.projection_pack.build"
                ),
            },
            "recipe": {
                "id": "atlas-projection-pack-v1",
                "created_at": created_at,
                "static_source_mode": static_mode,
                "static_projection_modes": static_projection_modes,
                "registered_parent_pack_id": registered_manifest["pack_id"],
                "registered_parent_manifest_sha256": _sha(manifest_raw),
                "grid_id": grid_id,
                **(
                    {
                        "license_notice": {
                            "format": "ibl-static-asset-license-v1",
                            "resource": _plain_resource(
                                STATIC_LICENSE_RELATIVE_PATH,
                                license_notice,
                                "text/plain; charset=utf-8",
                            ),
                        }
                    }
                    if license_notice is not None
                    else {}
                ),
            },
            "notes": [
                "Static maps are affine-free and carry no scientific navigation coordinates.",
                *(
                    [
                        "Synthetic static geometry is test-only and is not a scientific atlas release."
                    ]
                    if static_mode == "synthetic-fixture"
                    else []
                ),
                *(
                    [
                        "Top uses exact pinned bytes in this historical local visual-review lane.",
                        "Swanson remains synthetic test geometry in this mixed review pack.",
                        "This review pack must not be published as a scientific release.",
                    ]
                    if static_mode == "pinned-top-review"
                    else []
                ),
            ],
        }
        result = {
            "schema_version": "1.0",
            "format": "atlas-projection-pack-v1",
            "pack_id": pack_id,
            "immutable": True,
            "reference_space_id": reference_space_id,
            "mappings": ["allen", "beryl", "cosmos"],
            "projections": [*registered, *static],
            "provenance": provenance,
        }
        validate_schema_v1_document(result, "projection-pack.schema.json")
        (stage / "manifest.json").write_bytes(_canonical(result))
        validate_projection_pack(stage)
        shutil.move(stage, output)
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--registered-parent", type=Path, required=True)
    parser.add_argument("--regions", type=Path, required=True)
    parser.add_argument("--top", type=Path, required=True)
    parser.add_argument("--swanson", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--created-at", required=True)
    parser.add_argument(
        "--license-evidence",
        help="optional assertion; if provided it must match the committed authorized record",
    )
    parser.add_argument("--reference-space-id", default=REFERENCE_SPACE_ID)
    parser.add_argument("--grid-id", default=GRID_ID)
    args = parser.parse_args()
    repository = Path(__file__).resolve().parents[2]
    commit = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=repository,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    dirty = subprocess.run(
        ["git", "status", "--porcelain", "--untracked-files=no"],
        cwd=repository,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    if dirty:
        raise RuntimeError("refusing provenance build from a dirty tracked worktree")
    build_projection_pack(
        args.registered_parent,
        args.regions,
        {"top": args.top, "swanson": args.swanson},
        args.output,
        created_at=args.created_at,
        generator_commit=commit,
        reference_space_id=args.reference_space_id,
        grid_id=args.grid_id,
        license_evidence=args.license_evidence,
    )


if __name__ == "__main__":
    main()
