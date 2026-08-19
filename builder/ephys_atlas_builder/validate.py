from __future__ import annotations

import gzip
import json
from itertools import product
from pathlib import Path

from jsonschema import Draft202012Validator
from referencing import Registry, Resource

from .io import DTYPES, sha256_file


class ValidationError(RuntimeError):
    pass


def _schema_registry(schema_dir: Path) -> tuple[Registry, dict[str, dict]]:
    schemas = {}
    registry = Registry()
    for path in sorted(schema_dir.glob("*.schema.json")):
        schema = json.loads(path.read_text())
        schemas[path.name] = schema
        registry = registry.with_resource(schema["$id"], Resource.from_contents(schema))
    return registry, schemas


def _validate_json(instance: dict, schema_name: str, schemas: dict[str, dict], registry: Registry) -> None:
    validator = Draft202012Validator(schemas[schema_name], registry=registry)
    errors = sorted(validator.iter_errors(instance), key=lambda e: list(e.absolute_path))
    if errors:
        lines = [f"{schema_name}: {'.'.join(map(str, e.absolute_path))}: {e.message}" for e in errors]
        raise ValidationError("\n".join(lines))


def _check_binary(root: Path, meta: dict) -> None:
    path = root / meta["path"]
    if not path.is_file():
        raise ValidationError(f"missing binary payload: {path}")
    expected = 1
    for n in meta["shape"]:
        expected *= n
    expected *= DTYPES[meta["dtype"]].itemsize
    if path.stat().st_size != expected:
        raise ValidationError(f"wrong byte size for {path}: {path.stat().st_size} != {expected}")
    if meta.get("bytes") is not None and path.stat().st_size != meta["bytes"]:
        raise ValidationError(f"declared byte size mismatch for {path}")
    if meta.get("sha256") and sha256_file(path) != meta["sha256"]:
        raise ValidationError(f"sha256 mismatch for {path}")


def _check_artifact(root: Path, artifact: dict) -> None:
    path = root / artifact["path"]
    if not path.is_file():
        raise ValidationError(f"missing artifact: {path}")
    if path.stat().st_size != artifact["bytes"]:
        raise ValidationError(f"declared artifact byte size mismatch for {path}")
    if sha256_file(path) != artifact["sha256"]:
        raise ValidationError(f"artifact sha256 mismatch for {path}")


def _check_volume(root: Path, meta: dict) -> None:
    shape = meta["grid"]["shape"]
    chunk_shape = meta["chunks"]["shape"]
    nchunks = [(shape[d] + chunk_shape[d] - 1) // chunk_shape[d] for d in range(3)]
    template = meta["chunks"]["path_template"]
    dtype = DTYPES[meta["array"]["dtype"]]
    codec = meta["chunks"]["codec"]["name"]
    for i0, i1, i2 in product(*(range(n) for n in nchunks)):
        path = root / template.format(i0=i0, i1=i1, i2=i2)
        if not path.is_file():
            raise ValidationError(f"missing volume chunk: {path}")
        starts = [i0 * chunk_shape[0], i1 * chunk_shape[1], i2 * chunk_shape[2]]
        actual_shape = [min(chunk_shape[d], shape[d] - starts[d]) for d in range(3)]
        expected = dtype.itemsize
        for n in actual_shape:
            expected *= n
        if codec == "none":
            actual = path.stat().st_size
        elif codec == "gzip":
            with gzip.open(path, "rb") as f:
                actual = len(f.read())
        else:
            raise ValidationError(f"unsupported volume codec: {codec}")
        if actual != expected:
            raise ValidationError(f"wrong decoded chunk size for {path}: {actual} != {expected}")


def validate_release(release_dir: Path, schema_dir: Path) -> None:
    release_dir = release_dir.resolve()
    registry, schemas = _schema_registry(schema_dir)
    manifest = json.loads((release_dir / "manifest.json").read_text())
    _validate_json(manifest, "dataset.schema.json", schemas, registry)

    for parcellation in manifest["parcellations"]:
        _check_binary(release_dir, parcellation["region_index"])
        metadata = release_dir / parcellation["metadata"]
        if not metadata.is_file():
            raise ValidationError(f"missing parcellation metadata: {metadata}")

    for artifact in manifest["artifacts"]:
        _check_artifact(release_dir, artifact)

    for feature_ref in manifest["features"]:
        feature_path = release_dir / feature_ref["path"]
        feature = json.loads(feature_path.read_text())
        _validate_json(feature, "feature.schema.json", schemas, registry)
        if feature["id"] != feature_ref["id"]:
            raise ValidationError(f"feature id mismatch: {feature_path}")
        feature_root = feature_path.parent
        regional = feature["representations"].get("regional")
        if regional:
            for parc in regional["parcellations"]:
                _check_binary(feature_root, parc["values"])
                stats_path = feature_root / parc["statistics"]
                stats = json.loads(stats_path.read_text())
                _validate_json(stats, "statistics.schema.json", schemas, registry)
                _check_binary(stats_path.parent, stats["regional_summary"]["values"])
                if "histogram" in stats:
                    _check_binary(stats_path.parent, stats["histogram"]["regional_counts"])
        for artifact in feature["artifacts"]:
            _check_artifact(feature_root, artifact)
        volume = feature["representations"].get("volume")
        if volume:
            _check_volume(feature_root, volume)
