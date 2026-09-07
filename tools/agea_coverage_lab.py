"""Prepare a local, exploratory AGEA coverage lab from hash-pinned audit inputs."""
from __future__ import annotations

import argparse
import gzip
import hashlib
import inspect
import json
from pathlib import Path

import numpy as np
import pandas as pd
from iblatlas.genomics import agea

from tools.agea_benchmark import SHAPE, SOURCE_HASHES, verify, value_counts
from tools.agea_alignment_evidence import derive_alignment_evidence, load_projection_manifest, sha256


def resource(output: Path, name: str, raw: bytes) -> dict:
    encoded = gzip.compress(raw, compresslevel=6, mtime=0)
    (output / name).write_bytes(encoded)
    return dict(path=name, bytes=len(encoded), sha256=hashlib.sha256(encoded).hexdigest(),
                decoded_bytes=len(raw), codec="gzip")


def build(source: Path, transport: Path, projection_manifest: Path | None = None) -> None:
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
    loader_origin = atlas.bc.i2xyz(np.zeros(3)) * 1e6
    loader_affine = np.eye(4)
    loader_affine[:3, 3] = loader_origin
    for dimension, basis in enumerate(np.eye(3)):
        loader_affine[:3, dimension] = (
            atlas.bc.i2xyz(basis[atlas.dims2xyz]) * 1e6 - loader_origin
        )
    audited_affine = np.asarray(audit["loader_evidence"]["index_to_world_um"]).reshape(4, 4)
    if not np.allclose(loader_affine, audited_affine, atol=1e-9):
        raise ValueError("Pinned loader affine does not match transport audit")
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
    image = np.load(source / "image.npy", allow_pickle=False)
    if image.shape != SHAPE[1:]:
        raise ValueError("Unexpected anatomy image shape")
    image = np.asarray(image, dtype="<f4", order="C")
    anatomy_image = resource(transport, "lab-anatomy-image.f32.gz", image.tobytes(order="C"))

    if projection_manifest is None:
        projection_manifest = Path(__file__).resolve().parents[1] / (
            "web/public/atlas/projections/ibl-static-registered-v1/manifest.json"
        )
    native_manifest, projection_resource = load_projection_manifest(projection_manifest)
    evidence = derive_alignment_evidence(
        loader_affine.ravel(), SHAPE[1:], native_manifest
    )
    candidate_reference_space_id = evidence.pop("candidate_reference_space_id")
    evidence.update({
        "source_loader_module_sha256": audit["loader_evidence"]["module_sha256"],
        "template_provenance": {
            "description": "image.npy was generated from the 25 um CCF template mean; label.npy used modal labels",
            "independent_biological_alignment_evidence": False,
        },
    })
    alignment = {
        "candidate_reference_space_id": candidate_reference_space_id,
        "projection_pack_url": "/atlas/projections/ibl-static-registered-v1/manifest.json",
        "projection_pack": projection_resource,
        "evidence": evidence,
    }
    generation_script = Path(inspect.getfile(agea)).parent / "gene_expression_scrapping/05-generate-atlas-templates.py"
    if generation_script.is_file():
        evidence["template_provenance"]["generation_script"] = {
            "path": "iblatlas/genomics/gene_expression_scrapping/05-generate-atlas-templates.py",
            "bytes": generation_script.stat().st_size,
            "sha256": sha256(generation_script),
        }
    manifest = dict(
        format="agea-coverage-lab-only", scientific_release=False, source_variant="original",
        source=sources, shape=list(SHAPE[1:]), axis_order=["ML", "DV", "AP"],
        index_to_world_um=audit["loader_evidence"]["index_to_world_um"],
        geometry_status="Source-loader coordinates; registration to production anatomy is not approved",
        labels=resource(transport, "lab-labels.i32.gz", labels.tobytes()),
        measured_counts=resource(transport, "lab-measured-counts.u16.gz", measured_counts.tobytes()),
        anatomy_image=anatomy_image,
        alignment=alignment,
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
    parser.add_argument("--projection-manifest", type=Path)
    args = parser.parse_args()
    build(args.source, args.transport, args.projection_manifest)
