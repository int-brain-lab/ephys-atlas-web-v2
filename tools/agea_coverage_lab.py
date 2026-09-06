"""Prepare a local, exploratory AGEA coverage lab from hash-pinned audit inputs."""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
from pathlib import Path

import numpy as np
import pandas as pd
from iblatlas.genomics import agea

from tools.agea_benchmark import SHAPE, SOURCE_HASHES, verify, value_counts


def resource(output: Path, name: str, raw: bytes) -> dict:
    encoded = gzip.compress(raw, compresslevel=6, mtime=0)
    (output / name).write_bytes(encoded)
    return dict(path=name, bytes=len(encoded), sha256=hashlib.sha256(encoded).hexdigest(),
                decoded_bytes=len(raw), codec="gzip")


def build(source: Path, transport: Path) -> None:
    sources = {name: verify(source / name, expected) for name, expected in SOURCE_HASHES.items()}
    audit = json.loads((transport / "audit.json").read_text())
    verify(transport / audit["metadata"]["path"], audit["metadata"]["sha256"])
    metadata = json.loads(gzip.decompress((transport / audit["metadata"]["path"]).read_bytes()))
    if any(metadata["source"]["files"].get(name) != entry for name, entry in sources.items()):
        raise ValueError("Transport and source identity mismatch")
    rows = pd.read_parquet(source / "gene-expression.pqt").to_dict("records")
    if [(f["experiment_id"], f["gene"]) for f in metadata["features"]] != [(r["id"], r["gene"]) for r in rows]:
        raise ValueError("Transport experiment ordering does not match the pinned gene table")
    atlas = agea.load_atlas(source)
    labels = np.asarray(atlas.regions.id[atlas.label], dtype="<i4")
    if labels.shape != SHAPE[1:]:
        raise ValueError("Unexpected label shape")
    volume = np.memmap(source / "gene-expression.bin", dtype="<f2", mode="r", shape=SHAPE)
    measured_counts = np.zeros(SHAPE[1:], dtype="<u2")
    features = []
    for index, feature in enumerate(metadata["features"]):
        values = volume[index]
        measured_counts += np.isfinite(values) & (values >= 0)
        counts = value_counts(values, labels != 0)
        descriptor = feature["volume"]
        # Existing immutable transport bytes must agree before the lab exposes them.
        verify(transport / descriptor["path"], descriptor["sha256"])
        features.append(dict(id=feature["id"], gene=feature["gene"],
                             experiment_id=feature["experiment_id"], volume=descriptor, counts=counts))
    indices = np.unique(atlas.label)
    regions = {str(int(atlas.regions.id[i])): dict(name=str(atlas.regions.name[i]),
               acronym=str(atlas.regions.acronym[i])) for i in indices}
    manifest = dict(
        format="agea-coverage-lab-only", scientific_release=False, source_variant="original",
        source=sources, shape=list(SHAPE[1:]), axis_order=["ML", "DV", "AP"],
        index_to_world_um=audit["loader_evidence"]["index_to_world_um"],
        geometry_status="Source-loader coordinates; registration to production anatomy is not approved",
        labels=resource(transport, "lab-labels.i32.gz", labels.tobytes()),
        measured_counts=resource(transport, "lab-measured-counts.u16.gz", measured_counts.tobytes()),
        regions=regions, features=features,
    )
    descriptor = resource(transport, "coverage-lab.json.gz", json.dumps(
        manifest, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode())
    (transport / "coverage-lab-index.json").write_text(json.dumps(descriptor, indent=2) + "\n")
    print(json.dumps(descriptor, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--transport", type=Path, required=True)
    args = parser.parse_args()
    build(args.source, args.transport)
