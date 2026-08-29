from __future__ import annotations

import email
import hashlib
from pathlib import Path
import subprocess
import tomllib
import zipfile

from ephys_atlas_builder.bundle import validate_bundle
from ephys_atlas_builder.schema_v1 import SCHEMA_DIR
from ephys_atlas_builder.validate import validate_release


ROOT = Path(__file__).resolve().parents[1]
SOURCE_SCHEMA = ROOT / "schema" / "v1"


def _inventory(root: Path) -> dict[str, str]:
    return {
        path.name: hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sorted(root.iterdir())
        if path.is_file()
    }


def test_bundled_schema_is_an_exact_generated_copy() -> None:
    assert SCHEMA_DIR == ROOT / "builder" / "ibl_ephys_atlas" / "_schema" / "v1"
    assert _inventory(SCHEMA_DIR) == _inventory(SOURCE_SCHEMA)


def test_validator_and_bundle_default_to_the_bundled_schema() -> None:
    validate_release(ROOT / "fixtures" / "golden-v1")
    validate_bundle(ROOT / "fixtures" / "golden-v1.ibl-ephys-atlas.zip")


def test_project_metadata_exposes_both_namespaces_and_retains_internal_cli() -> None:
    project = tomllib.loads((ROOT / "builder" / "pyproject.toml").read_text())
    assert project["project"]["name"] == "ibl-ephys-atlas"
    assert project["project"]["scripts"]["ephys-atlas-data"] == "ephys_atlas_builder.cli:main"
    assert project["tool"]["setuptools"]["packages"]["find"]["include"] == [
        "ibl_ephys_atlas*",
        "ephys_atlas_builder*",
    ]
    assert "iblatlas>=1.2,<2" in project["project"]["dependencies"]
    assert all("iblatlas" not in item for item in project["project"]["optional-dependencies"]["scientific"])
    assert all("iblatlas" not in item for item in project["project"]["optional-dependencies"]["anatomy"])
    assert project["tool"]["uv"]["sources"]["iblatlas"]["rev"] == (
        "52083adf44825d0622a503705e095699a5957587"
    )


def test_wheel_contains_both_namespaces_schema_and_publishable_metadata(tmp_path: Path) -> None:
    subprocess.run(
        [
            "uv",
            "build",
            str(ROOT / "builder"),
            "--wheel",
            "--out-dir",
            str(tmp_path),
            "--no-build-logs",
            "--no-create-gitignore",
        ],
        check=True,
    )
    wheels = list(tmp_path.glob("*.whl"))
    assert len(wheels) == 1
    with zipfile.ZipFile(wheels[0]) as wheel:
        names = set(wheel.namelist())
        assert "ibl_ephys_atlas/__init__.py" in names
        assert "ephys_atlas_builder/cli.py" in names
        for path in SOURCE_SCHEMA.iterdir():
            if path.is_file():
                member = f"ibl_ephys_atlas/_schema/v1/{path.name}"
                assert member in names
                assert wheel.read(member) == path.read_bytes()

        metadata_name = next(name for name in names if name.endswith(".dist-info/METADATA"))
        metadata = email.message_from_bytes(wheel.read(metadata_name))
        assert metadata["Name"] == "ibl-ephys-atlas"
        requirements = metadata.get_all("Requires-Dist", [])
        assert any(requirement.startswith("iblatlas<2,>=1.2") for requirement in requirements)
        assert not any("git+https://github.com/int-brain-lab/iblatlas" in requirement for requirement in requirements)

        entry_points_name = next(
            name for name in names if name.endswith(".dist-info/entry_points.txt")
        )
        assert "ephys-atlas-data = ephys_atlas_builder.cli:main" in wheel.read(
            entry_points_name
        ).decode()
