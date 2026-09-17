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

from tools import s3_publish
from tools.agea_preview import (
    build_preview,
    build_processed_release,
    build_production_release,
)
from tools.release_preflight import RepositoryState, check_release

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
    processed = np.array(
        [
            [[[-1, 0], [2, 4]], [[-1, 0], [2, 4]]],
            [[[-0.5, 3], [5, 7]], [[-0.5, 3], [5, 7]]],
        ],
        dtype="<f2",
    )
    (source / "gene-expression-processed.bin").write_bytes(processed.tobytes())
    pd.DataFrame(
        [{"id": "101", "gene": "GeneA"}, {"id": "202", "gene": "GeneA"}]
    ).to_parquet(source / "gene-expression.pqt", index=False)
    np.save(
        source / "label.npy",
        np.array([[[1, 1], [0, 0]], [[1, 1], [0, 0]]], dtype="u1"),
    )
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


def _processed_hashes(source: Path, original_hashes: dict[str, str]) -> dict[str, str]:
    return {
        "gene-expression-processed.bin": _sha(source / "gene-expression-processed.bin"),
        **{
            name: digest
            for name, digest in original_hashes.items()
            if name != "gene-expression.bin"
        },
    }


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


def test_builds_preflightable_original_release_with_provisional_notes_only_in_provenance(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    source, hashes = _source(tmp_path)
    review = tmp_path / "review.json"
    review.write_text('{"alignment_accepted":false}\n')
    commit = "a" * 40
    release = build_production_release(
        source,
        tmp_path / "production",
        created_at="2026-09-08T12:00:00Z",
        alignment_review=review,
        shape=(2, 2, 2, 2),
        source_hashes=hashes,
        affine=AFFINE,
        builder_commit=commit,
        release_id="agea-original-20260908-v1",
    )
    manifest = json.loads((release / "manifest.json").read_text())
    catalog = json.loads((release.parents[2] / "catalog.json").read_text())
    assert release.name == "agea-original-20260908-v1"
    assert manifest["title"] == "Allen Gene Expression Atlas"
    assert manifest["provenance"]["recipe"]["id"] == "agea-original-v1"
    assert manifest["provenance"]["recipe"]["decision"] == "D074"
    assert manifest["provenance"]["recipe"]["registration_status"] == "provisional"
    assert "-1 is treated as missing" in manifest["provenance"]["notes"][1]
    assert "Alignment with the anatomical atlas is provisional" in manifest["provenance"]["notes"][2]
    assert "preview" not in json.dumps(catalog).lower()
    assert "status" not in catalog["datasets"][0]["releases"][0]
    assert (release / review.name).read_bytes() == review.read_bytes()
    assert (release / "agea_preview.py").read_bytes() == Path("tools/agea_preview.py").read_bytes()
    check_release(
        release,
        repo=RepositoryState(branch="main", commit=commit, clean=True),
        host_os="Linux",
    )
    monkeypatch.setattr(
        s3_publish, "repository_state",
        lambda _root: RepositoryState(branch="main", commit=commit, clean=True),
    )
    monkeypatch.setattr(s3_publish.platform, "system", lambda: "Linux")
    with s3_publish.validated_snapshot(release) as (snapshot, files):
        assert {"manifest.json", review.name, "agea_preview.py"} <= set(files)
        assert (snapshot / review.name).read_bytes() == review.read_bytes()
        assert (snapshot / "agea_preview.py").read_bytes() == Path("tools/agea_preview.py").read_bytes()


def test_builds_processed_release_with_label_domain_and_signed_values(
    tmp_path: Path,
) -> None:
    source, original_hashes = _source(tmp_path)
    hashes = _processed_hashes(source, original_hashes)
    review = tmp_path / "review.json"
    review.write_text('{"alignment_accepted":false}\n')
    release = build_processed_release(
        source,
        tmp_path / "processed",
        created_at="2026-09-17T12:00:00Z",
        alignment_review=review,
        shape=(2, 2, 2, 2),
        source_hashes=hashes,
        affine=AFFINE,
        builder_commit="b" * 40,
        release_id="agea-processed-20260917-v1",
        selection=Path("docs/data/AGEA_PROCESSED_SELECTION.json"),
    )
    validate_release(release)
    manifest = json.loads((release / "manifest.json").read_text())
    recipe = manifest["provenance"]["recipe"]
    assert recipe["id"] == "agea-processed-v1"
    assert recipe["decision"] == "D077"
    assert recipe["source_variant"] == "processed"
    assert recipe["validity"] == {
        "valid": "every finite processed value where label.npy != 0",
        "missing": "none; processed values equal to -1 remain valid",
        "outside": "label.npy == 0",
    }
    sources = manifest["provenance"]["sources"]
    processed_source = next(
        item for item in sources if item.get("uri", "").endswith("gene-expression-processed.bin")
    )
    assert processed_source["sha256"] == hashes["gene-expression-processed.bin"]
    selection = next(
        item for item in sources if item.get("description", "").startswith("Processed AGEA source")
    )
    assert selection["path"] == "AGEA_PROCESSED_SELECTION.json"
    assert (release / selection["path"]).read_bytes() == Path(
        "docs/data/AGEA_PROCESSED_SELECTION.json"
    ).read_bytes()

    feature_root = release / "features/experiment-101"
    feature = json.loads((feature_root / "feature.json").read_text())
    assert feature["value_semantics"]["quantity"] == (
        "Allen gene expression energy after IBL processing"
    )
    assert "PPCA reconstruction" in feature["value_semantics"]["transform"]
    mask = np.frombuffer(
        gzip.decompress((feature_root / "volume/validity.u8.gz").read_bytes()), dtype="u1"
    )
    assert mask.tolist() == [0, 0, 1, 1, 0, 0, 1, 1]
    summary = json.loads((feature_root / "volume/summary.json").read_text())
    assert (
        summary["valid_voxel_count"],
        summary["outside_voxel_count"],
        summary["missing_voxel_count"],
        summary["valid_statistics"]["min"],
    ) == (4, 4, 0, -1.0)
    chunk = gzip.decompress((feature_root / "volume/chunks/0.0.0.f16.gz").read_bytes())
    assert chunk == (source / "gene-expression-processed.bin").read_bytes()[:16]


@pytest.mark.parametrize("release_id", ["agea-local-preview-v1", "agea-candidate-v1"])
def test_production_release_rejects_local_or_candidate_identity(tmp_path: Path, release_id: str) -> None:
    source, hashes = _source(tmp_path)
    review = tmp_path / "review.json"
    review.write_text("{}\n")
    with pytest.raises(ValueError, match="cannot be candidate or local"):
        build_production_release(
            source,
            tmp_path / "production",
            created_at="2026-09-08T12:00:00Z",
            alignment_review=review,
            shape=(2, 2, 2, 2),
            source_hashes=hashes,
            affine=AFFINE,
            builder_commit="a" * 40,
            release_id=release_id,
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
