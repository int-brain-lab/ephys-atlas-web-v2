from __future__ import annotations

from pathlib import Path
import zipfile

import pytest

from ephys_atlas_builder.bundle import validate_bundle, write_bundle
from ephys_atlas_builder.fixture import generate_golden
from ephys_atlas_builder.validate import ValidationError


ROOT = Path(__file__).resolve().parents[1]
SCHEMA = ROOT / "schema" / "v1"


def test_bundle_is_deterministic_rooted_and_independently_validated(tmp_path: Path) -> None:
    release = generate_golden(tmp_path / "release")
    first = tmp_path / "first.ibl-ephys-atlas.zip"
    second = tmp_path / "second.ibl-ephys-atlas.zip"

    a = write_bundle(release, first, SCHEMA)
    b = write_bundle(release, second, SCHEMA)

    assert first.read_bytes() == second.read_bytes()
    assert a["sha256"] == b["sha256"]
    with zipfile.ZipFile(first) as archive:
        names = archive.namelist()
        assert names == sorted(names)
        assert names[0] == "features/rms_ap/allen.distribution.linear-focused.u32"
        assert "manifest.json" in names
        assert all(not name.startswith("release/") for name in names)
    assert validate_bundle(first, SCHEMA)["file_count"] == len(names)


def test_checked_in_bundle_is_exactly_regenerated(tmp_path: Path) -> None:
    generated = tmp_path / "golden.ibl-ephys-atlas.zip"
    write_bundle(ROOT / "fixtures" / "golden-v1", generated, SCHEMA)

    assert generated.read_bytes() == (
        ROOT / "fixtures" / "golden-v1.ibl-ephys-atlas.zip"
    ).read_bytes()
    assert generated.stat().st_mode & 0o777 == 0o644


def test_bundle_rejects_undeclared_release_files(tmp_path: Path) -> None:
    release = generate_golden(tmp_path / "release")
    (release / "undeclared.txt").write_text("not in the resource graph")

    with pytest.raises(ValidationError, match="undeclared"):
        write_bundle(release, tmp_path / "bad.ibl-ephys-atlas.zip", SCHEMA)


@pytest.mark.parametrize("name", ["../escape.txt", "/absolute.txt", "back\\slash.txt"])
def test_bundle_rejects_unsafe_paths(tmp_path: Path, name: str) -> None:
    bundle = tmp_path / "unsafe.ibl-ephys-atlas.zip"
    with zipfile.ZipFile(bundle, "w") as archive:
        archive.writestr("manifest.json", "{}")
        archive.writestr(name, "bad")

    with pytest.raises(ValidationError, match="unsafe ZIP path"):
        validate_bundle(bundle, SCHEMA)


def test_failed_bundle_does_not_replace_existing_output(tmp_path: Path) -> None:
    release = generate_golden(tmp_path / "release")
    output = tmp_path / "dataset.ibl-ephys-atlas.zip"
    output.write_bytes(b"keep me")
    (release / "manifest.json").write_text("not json")

    with pytest.raises(ValidationError):
        write_bundle(release, output, SCHEMA)
    assert output.read_bytes() == b"keep me"
