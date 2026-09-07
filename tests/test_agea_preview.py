from __future__ import annotations

import gzip
import hashlib
import json
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
from ephys_atlas_builder.schema_v1 import validate_schema_v1_document
from ephys_atlas_builder.validate import validate_release

from tools.agea_preview import build_preview

AFFINE = (
    200.0,
    0.0,
    0.0,
    -5739.0,
    0.0,
    0.0,
    -200.0,
    5400.0,
    0.0,
    -200.0,
    0.0,
    332.0,
    0.0,
    0.0,
    0.0,
    1.0,
)


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _source(tmp_path: Path) -> tuple[Path, dict[str, str]]:
    source = tmp_path / "source"
    source.mkdir()
    values = np.array(
        [
            [[[-1, 0], [2, 4]], [[6, 8], [10, 12]]],
            [[[1, 3], [5, 7]], [[9, 11], [13, -1]]],
        ],
        dtype="<f2",
    )
    (source / "gene-expression.bin").write_bytes(values.tobytes())
    pd.DataFrame(
        [{"id": "101", "gene": "GeneA"}, {"id": "202", "gene": "GeneA"}]
    ).to_parquet(source / "gene-expression.pqt", index=False)
    np.save(source / "label.npy", np.zeros((2, 2, 2), dtype="u1"))
    np.save(source / "image.npy", np.zeros((2, 2, 2), dtype="f4"))
    hashes = {
        name: _sha(source / name)
        for name in (
            "gene-expression.bin",
            "gene-expression.pqt",
            "label.npy",
            "image.npy",
        )
    }
    return source, hashes


def test_builds_complete_local_preview_without_changing_source_semantics(
    tmp_path: Path,
) -> None:
    source, hashes = _source(tmp_path)
    review = tmp_path / "review.json"
    review.write_text('{"decision":"local preview only; registration provisional"}\n')
    output = tmp_path / "preview"
    release = build_preview(
        source,
        output,
        created_at="2026-09-07T12:00:00Z",
        alignment_review=review,
        shape=(2, 2, 2, 2),
        source_hashes=hashes,
        affine=AFFINE,
        builder_commit="abcdef0123456789",
    )
    validate_release(release)
    catalog = json.loads((output / "catalog.json").read_text())
    validate_schema_v1_document(catalog, "catalog.schema.json")
    manifest = json.loads((release / "manifest.json").read_text())
    assert manifest["dataset_id"] == "agea"
    release_id = manifest["release"]["release_id"]
    assert release_id.startswith(
        f"agea-original-local-preview-{hashes['gene-expression.bin'][:8]}-abcdef01-"
    )
    assert len(release_id.rsplit("-", 1)[1]) == 8
    assert "local preview; registration provisional" in manifest["title"]
    assert [item["id"] for item in manifest["features"]] == [
        "experiment-101",
        "experiment-202",
    ]
    first_root = release / "features/experiment-101"
    feature = json.loads((first_root / "feature.json").read_text())
    assert feature["label"] == "GeneA · 101"
    assert feature["representations"]["volume"]["grid"]["index_to_world_um"] == list(
        AFFINE
    )
    assert feature["representations"]["volume"]["validity"]["kind"] == "mask"
    mask = np.frombuffer(
        gzip.decompress((first_root / "volume/validity.u8.gz").read_bytes()), dtype="u1"
    )
    assert mask.tolist() == [2, 0, 0, 0, 0, 0, 0, 0]
    summary = json.loads((first_root / "volume/summary.json").read_text())
    assert (
        summary["valid_voxel_count"],
        summary["outside_voxel_count"],
        summary["missing_voxel_count"],
    ) == (7, 0, 1)
    assert summary["valid_statistics"]["min"] == 0.0
    chunk = gzip.decompress((first_root / "volume/chunks/0.0.0.f16.gz").read_bytes())
    assert chunk == (source / "gene-expression.bin").read_bytes()[:16]
    bundle = gzip.decompress(
        (release / manifest["metadata_bundle"]["path"]).read_bytes()
    )
    bundle_document = json.loads(bundle)
    assert len(bundle_document["resources"]) == 6


def test_refuses_existing_output_and_changed_source(tmp_path: Path) -> None:
    source, hashes = _source(tmp_path)
    review = tmp_path / "review.json"
    review.write_text("{}\n")
    output = tmp_path / "preview"
    output.mkdir()
    with pytest.raises(ValueError, match="already exists"):
        build_preview(
            source,
            output,
            created_at="2026-09-07T12:00:00Z",
            alignment_review=review,
            shape=(2, 2, 2, 2),
            source_hashes=hashes,
            affine=AFFINE,
            builder_commit="abcdef0",
        )
    output.rmdir()
    hashes["gene-expression.bin"] = "0" * 64
    with pytest.raises(ValueError, match="Source hash mismatch"):
        build_preview(
            source,
            output,
            created_at="2026-09-07T12:00:00Z",
            alignment_review=review,
            shape=(2, 2, 2, 2),
            source_hashes=hashes,
            affine=AFFINE,
            builder_commit="abcdef0",
        )


@pytest.mark.parametrize("invalid", [-2.0, np.nan, np.inf])
def test_rejects_values_outside_authorized_zero_positive_or_minus_one_policy(
    tmp_path: Path, invalid: float
) -> None:
    source, hashes = _source(tmp_path)
    values = np.frombuffer(
        (source / "gene-expression.bin").read_bytes(), dtype="<f2"
    ).copy()
    values[0] = invalid
    (source / "gene-expression.bin").write_bytes(values.tobytes())
    hashes["gene-expression.bin"] = _sha(source / "gene-expression.bin")
    review = tmp_path / "review.json"
    review.write_text("{}\n")
    with pytest.raises(ValueError, match="nonfinite or unsupported negative"):
        build_preview(
            source,
            tmp_path / "preview",
            created_at="2026-09-07T12:00:00Z",
            alignment_review=review,
            shape=(2, 2, 2, 2),
            source_hashes=hashes,
            affine=AFFINE,
            builder_commit="abcdef0",
        )
