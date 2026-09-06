"""Audit pinned original AGEA inputs and prepare transport-only browser evidence.

This is not a scientific release builder. No registration or validity policy is
approved by this experiment, and its JSON is deliberately not a release manifest.
"""

from __future__ import annotations

import argparse
from collections import Counter
import gzip
import hashlib
import inspect
import json
from pathlib import Path
import platform
import re
import zipfile

import numpy as np
import pandas as pd
from iblatlas.genomics import agea


SOURCE_HASHES = {
    "gene-expression.bin": "86b4997133435f830c33941e443d86baf1ef4195a8eb6343f5a9df2523f8e69d",
    "gene-expression.pqt": "90433973765b0361921c48dc70bce8291885c427d23d930b1eb6617348024572",
    "label.npy": "0a09957f2e6b9c70081928e15587e9f3b97382ac7a79baa2788160206ad8a81a",
    "image.npy": "665d671ad51976e9e0680da43eab8b74d5d6e84c11c230be31451c00d3ea71ba",
}
SHAPE = (4345, 58, 41, 67)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def verify(path: Path, expected: str) -> dict:
    actual = sha256(path)
    if actual != expected:
        raise ValueError(f"Source hash mismatch: {path.name}")
    return {"bytes": path.stat().st_size, "sha256": actual}


def value_counts(values: np.ndarray, inside: np.ndarray) -> dict[str, int]:
    """Count disjoint source categories without selecting a production policy."""
    categories = {
        "nonfinite": ~np.isfinite(values),
        "minus_one": values == -1,
        "other_negative": np.isfinite(values) & (values < 0) & (values != -1),
        "zero": values == 0,
        "positive": np.isfinite(values) & (values > 0),
    }
    return {
        f"{location}_{name}": int(np.count_nonzero(mask & region))
        for location, region in (("label_nonzero", inside), ("label_zero", ~inside))
        for name, mask in categories.items()
    }


def slice_checksums(values: np.ndarray) -> dict:
    """Independent expected planes in the existing renderer's width/height order."""
    ml, dv, ap = values.shape
    planes = {
        "coronal": values[:, :, ap // 2].T,
        "sagittal": values[ml // 2, :, :],
        "horizontal": values[:, dv // 2, :].T,
    }
    return {
        axis: hashlib.sha256(np.asarray(plane, dtype="<f4").tobytes()).hexdigest()
        for axis, plane in planes.items()
    }


def run(source: Path, output: Path) -> None:
    sources = {name: verify(source / name, digest) for name, digest in SOURCE_HASHES.items()}
    rows = pd.read_parquet(source / "gene-expression.pqt").to_dict("records")
    if len(rows) != SHAPE[0] or len({row["id"] for row in rows}) != len(rows):
        raise ValueError("Unexpected experiment inventory")
    if any(not re.fullmatch(r"[0-9]+", row["id"]) for row in rows):
        raise ValueError("Unsafe experiment identifier")
    if (source / "gene-expression.bin").stat().st_size != int(np.prod(SHAPE)) * 2:
        raise ValueError("Unexpected volume byte length")
    labels = np.load(source / "label.npy", allow_pickle=False)
    if labels.shape != SHAPE[1:]:
        raise ValueError("Unexpected label shape")
    atlas = agea.load_atlas(source)
    origin = atlas.bc.i2xyz(np.zeros(3)) * 1e6
    source_affine = np.eye(4)
    source_affine[:3, 3] = origin
    for dimension, basis in enumerate(np.eye(3)):
        source_affine[:3, dimension] = atlas.bc.i2xyz(basis[atlas.dims2xyz]) * 1e6 - origin
    volumes = np.memmap(source / "gene-expression.bin", dtype="<f2", mode="r", shape=SHAPE)
    output.mkdir(parents=True, exist_ok=True)
    (output / "volumes").mkdir(exist_ok=True)
    features = []
    counts = Counter()
    for i, row in enumerate(rows):
        values = np.asarray(volumes[i])
        counts.update(value_counts(values, labels != 0))
        encoded = gzip.compress(values.tobytes(), compresslevel=6, mtime=0)
        relative = f"volumes/{row['id']}.bin.gz"
        (output / relative).write_bytes(encoded)
        # Explicit sizing assumption retained from the initial measurement.
        valid = values.astype(np.float64).ravel()
        valid = valid[np.isfinite(valid) & (valid >= 0)]
        stats = histogram = None
        if valid.size:
            stats = dict(min=float(valid.min()), max=float(valid.max()),
                         mean=float(valid.mean()), std=float(valid.std()))
            stats.update(zip(["q05", "q25", "median", "q75", "q95"],
                             np.quantile(valid, [.05, .25, .5, .75, .95]).tolist()))
            hist, edges = np.histogram(valid, bins=64)
            histogram = dict(scale="linear", domain="full", edges=edges.tolist(),
                             counts=hist.tolist(), underflow=0, overflow=0)
        features.append(dict(
            id=f"experiment-{row['id']}", gene=row["gene"], experiment_id=row["id"],
            volume=dict(path=relative, bytes=len(encoded), decoded_bytes=values.nbytes,
                        sha256=hashlib.sha256(encoded).hexdigest(), codec="gzip"),
            summary=dict(total_voxel_count=values.size, valid_voxel_count=int(valid.size),
                         excluded_voxel_count=int(values.size - valid.size),
                         valid_statistics=stats, distribution=histogram),
        ))
    metadata = dict(
        format="agea-transport-benchmark-only", production_release=False,
        source=dict(base_url="https://ibl-brain-wide-map-public.s3.amazonaws.com/atlas/agea/",
                    variant="original", files=sources),
        grid=dict(shape=list(SHAPE[1:]), axes=["ML", "DV", "AP"], spacing_um=200,
                  reference_space_id=None, affine=None),
        array=dict(dtype="float16", byte_order="little", order="C"),
        caveat="Transport only. Statistics use finite nonnegative values as a sizing assumption. "
               "Geometry, validity, processing and presentation remain unapproved.",
        features=features,
    )
    raw = json.dumps(metadata, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode()
    encoded = gzip.compress(raw, compresslevel=6, mtime=0)
    (output / "metadata.json.gz").write_bytes(encoded)
    ordered = sorted(range(len(features)), key=lambda i: features[i]["volume"]["bytes"])
    sample_indices = dict(first=0, median=ordered[len(ordered) // 2],
                          p95=ordered[int(np.ceil(len(ordered) * .95)) - 1], largest=ordered[-1])
    samples = {
        name: dict(index=i, **features[i], slice_sha256=slice_checksums(volumes[i]))
        for name, i in sample_indices.items()
    }
    duplicates = {name: count for name, count in Counter(row["gene"] for row in rows).items() if count > 1}
    report = dict(
        benchmark="agea-source-and-transport-v1", production_release=False,
        environment=dict(python=platform.python_version(), numpy=np.__version__,
                         platform=platform.platform(), script_sha256=sha256(Path(__file__)),
                         builder_lock_sha256=sha256(Path(__file__).resolve().parents[1] / "builder/uv.lock")),
        source=sources, experiments=len(rows), unique_symbols=len(set(row["gene"] for row in rows)),
        loader_evidence=dict(module_sha256=sha256(Path(inspect.getfile(agea))),
                             index_to_world_um=np.round(source_affine, 9).ravel().tolist(),
                             status="Derived from pinned iblatlas loader; not approved release registration"),
        duplicate_symbols=duplicates, shape=list(SHAPE), label_nonzero_voxels=int(np.count_nonzero(labels)),
        source_value_counts=dict(counts),
        metadata=dict(path="metadata.json.gz", bytes=len(encoded), decoded_bytes=len(raw),
                      sha256=hashlib.sha256(encoded).hexdigest()),
        all_volume_gzip_bytes=sum(f["volume"]["bytes"] for f in features), samples=samples,
    )
    allen_path = source / "allen-74658173.zip"
    if allen_path.exists():
        with zipfile.ZipFile(allen_path) as archive:
            header = archive.read("energy.mhd").decode()
            raw_allen = np.frombuffer(archive.read("energy.raw"), dtype="<f4")
            report["allen_sample"] = dict(
                experiment_id="74658173", sha256=sha256(allen_path), header=header,
                float16_matches_ibl=bool(np.array_equal(raw_allen.astype("<f2"), volumes[0].ravel())),
            )
    (output / "audit.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"metadata": report["metadata"], "experiments": len(rows),
                      "source_value_counts": dict(counts)}, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    run(args.source, args.output)
