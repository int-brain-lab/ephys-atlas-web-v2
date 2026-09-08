"""Build a clean Linux site with explicit same-origin deployment dependencies."""
from __future__ import annotations

import argparse
import hashlib
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

from ephys_atlas_builder.build_environment import build_environment
from tools.s3_assets import canonical_host
from tools.s3_publish import REPOSITORY
from ibl_ephys_atlas_publish.client import file_info
from ibl_ephys_atlas_publish.s3 import IMMUTABLE_CACHE, MUTABLE_CACHE, json_bytes


class SiteResources(HTMLParser):
    """Separate navigation links from resources the entry document loads."""

    def __init__(self):
        super().__init__()
        self.urls: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]):
        for name, value in attrs:
            if name in {"src", "href"} and not (tag == "a" and name == "href"):
                self.urls.append(value or "")


ATLAS_REGIONS_PATH = "atlas/allen-ccf-2017/regions.json"


def atlas_regions(config: dict) -> dict:
    descriptor = config.get("atlas_regions")
    if not isinstance(descriptor, dict) or set(descriptor) != {"path", "bytes", "sha256"}:
        raise ValueError("site config requires atlas_regions path/bytes/sha256")
    if (descriptor.get("path") != ATLAS_REGIONS_PATH
            or type(descriptor.get("bytes")) is not int or descriptor["bytes"] <= 0
            or not isinstance(descriptor.get("sha256"), str) or not re.fullmatch("[0-9a-f]{64}", descriptor["sha256"])):
        raise ValueError("site atlas_regions descriptor is invalid")
    return descriptor


def dependencies(config: dict) -> list[dict]:
    required = {"catalog", "projection", "atlas_regions"}
    optional = {"mesh", "default_view"}
    if not required.issubset(config) or not set(config).issubset(required | optional):
        raise ValueError("site config requires catalog/projection/atlas_regions, optional mesh and optional default_view")
    atlas_regions(config)
    result = []
    for kind in ("catalog", "projection", "mesh"):
        if kind not in config:
            continue
        descriptor = config[kind]
        if not isinstance(descriptor, dict) or set(descriptor) != {"path", "bytes", "sha256"}:
            raise ValueError("site dependencies require exact path/bytes/sha256")
        path = descriptor["path"]
        expected = {"catalog": r"catalog\.json", "projection": r"atlas/projections/[A-Za-z0-9][A-Za-z0-9._-]*/manifest\.json",
                    "mesh": r"atlas/meshes/[A-Za-z0-9][A-Za-z0-9._-]*/manifest\.json"}[kind]
        if (not isinstance(path, str) or not re.fullmatch(expected, path)
                or type(descriptor["bytes"]) is not int or descriptor["bytes"] <= 0
                or not isinstance(descriptor["sha256"], str) or not re.fullmatch("[0-9a-f]{64}", descriptor["sha256"])):
            raise ValueError("invalid same-origin site dependency")
        result.append({"path": path, "size": descriptor["bytes"], "sha256": descriptor["sha256"],
                       "content_type": "application/json", "cache_control": MUTABLE_CACHE if kind == "catalog" else IMMUTABLE_CACHE})
    return sorted(result, key=lambda d: d["path"])


def default_view(config: dict) -> dict[str, str] | None:
    """Validate a site-bound initial view against its tracked curator input."""
    raw = config.get("default_view")
    if raw is None:
        return None
    if not isinstance(raw, dict) or set(raw) != {
        "project_id", "dataset_id", "release_id", "feature_id", "parcellation_id", "curator_config",
    }:
        raise ValueError("site default_view requires project/dataset/release/feature/parcellation and curator_config")
    identifiers = {key: raw[key] for key in ("project_id", "dataset_id", "release_id", "feature_id", "parcellation_id")}
    if any(not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", value) for value in identifiers.values()):
        raise ValueError("site default_view identifiers are invalid")
    if identifiers["parcellation_id"] not in {"allen", "beryl", "cosmos"}:
        raise ValueError("site default_view parcellation is invalid")
    curator = raw["curator_config"]
    if not isinstance(curator, str) or not re.fullmatch(r"data/deployment/[A-Za-z0-9][A-Za-z0-9._-]*\.json", curator):
        raise ValueError("site default_view curator_config is invalid")
    curator_path = REPOSITORY / curator
    subprocess.run(["git", "ls-files", "--error-unmatch", "--", curator], cwd=REPOSITORY, check=True, capture_output=True)
    catalog = json.loads(curator_path.read_bytes())
    if catalog.get("default_project") != identifiers["project_id"]:
        raise ValueError("site default_view project must equal the curator default_project")
    projects = catalog.get("projects")
    datasets = catalog.get("datasets")
    if not isinstance(projects, list) or not isinstance(datasets, list):
        raise ValueError("site default_view curator config is invalid")
    project = next((item for item in projects if isinstance(item, dict) and item.get("project_id") == identifiers["project_id"]), None)
    dataset = next((item for item in datasets if isinstance(item, dict) and item.get("dataset_id") == identifiers["dataset_id"]), None)
    if project is None or dataset is None or dataset.get("default_release") != identifiers["release_id"]:
        raise ValueError("site default_view dataset/release is absent from curator defaults")
    if project.get("default_dataset") != identifiers["dataset_id"]:
        raise ValueError("site default_view dataset must equal the curator default_dataset")
    if identifiers["dataset_id"] not in project.get("dataset_ids", []):
        raise ValueError("site default_view dataset is outside curator project")
    edition_id = project.get("default_edition")
    edition = next((item for item in project.get("editions", []) if isinstance(item, dict) and item.get("edition_id") == edition_id), None)
    if edition is None or {"dataset_id": identifiers["dataset_id"], "release_id": identifiers["release_id"]} not in edition.get("dataset_releases", []):
        raise ValueError("site default_view release is absent from curator default edition")
    return {key: str(value) for key, value in identifiers.items()}


def build_environment_for_site(config: dict, build_id: str) -> dict[str, str]:
    dependencies(config)
    if not re.fullmatch("[0-9a-f]{32}", build_id):
        raise ValueError("site build identity is invalid")
    regions = atlas_regions(config)
    environment = {k: v for k, v in os.environ.items() if not k.startswith(("VITE_", "EPHYS_ATLAS_", "AGEA_"))}
    environment.update(
        EPHYS_ATLAS_SITE_BUILD="1",
        VITE_DATASET_CATALOG_URL="/catalog.json",
        VITE_PROJECTION_PACK_URL="/" + config["projection"]["path"],
        VITE_ATLAS_REGIONS_URL=f"/site/builds/{build_id}/{regions['path']}",
        VITE_ATLAS_REGIONS_BYTES=str(regions["bytes"]),
        VITE_ATLAS_REGIONS_SHA256=regions["sha256"],
    )
    if "mesh" in config:
        environment.update(VITE_BRAIN_MESH_MANIFEST_URL="/" + config["mesh"]["path"],
                           VITE_BRAIN_MESH_MANIFEST_BYTES=str(config["mesh"]["bytes"]),
                           VITE_BRAIN_MESH_MANIFEST_SHA256=config["mesh"]["sha256"])
    view = default_view(config)
    if view is not None:
        environment.update(
            VITE_DEFAULT_DATASET_ID=view["dataset_id"],
            VITE_DEFAULT_RELEASE_ID=view["release_id"],
            VITE_DEFAULT_FEATURE_ID=view["feature_id"],
            VITE_DEFAULT_PARCELLATION_ID=view["parcellation_id"],
        )
    return environment


def validate_site(root: Path, repo) -> dict:
    receipt = json.loads((root / "_site.json").read_bytes())
    if receipt.get("format") != "atlas-site-build-v1" or receipt.get("commit") != repo.commit or receipt.get("environment") != build_environment():
        raise ValueError("site requires exact current Linux build provenance")
    expected_dependencies = dependencies(receipt["config"])
    default_view(receipt["config"])
    if receipt.get("dependencies") != expected_dependencies:
        raise ValueError("site dependency inventory differs")
    identity = hashlib.sha256(json_bytes({k: receipt[k] for k in ("commit", "environment", "node", "config")})).hexdigest()[:32]
    if receipt.get("build_id") != identity:
        raise ValueError("site build identity differs")
    actual = {p.relative_to(root).as_posix(): file_info(p) for p in root.rglob("*") if p.is_file() and p.relative_to(root).as_posix() != "_site.json"}
    if actual != receipt["files"] or "index.html" not in actual:
        raise ValueError("site bytes/inventory differ")
    html = (root / "index.html").read_text()
    base = f"/site/builds/{identity}/"
    if base + "assets/" not in html or base + "favicon.png" not in html:
        raise ValueError("site HTML does not reference its immutable build")
    resources = SiteResources()
    resources.feed(html)
    for url in resources.urls:
        if not url.startswith(base) or url[len(base):] not in actual:
            raise ValueError("site HTML references a missing or non-build asset")
    regions = atlas_regions(receipt["config"])
    if actual.get(regions["path"]) != {"size": regions["bytes"], "sha256": regions["sha256"]}:
        raise ValueError("site atlas_regions file differs from its pinned descriptor")
    for path in actual:
        if not (path == "index.html" or path == "favicon.png" or path == "brand/ibl-core-logo.svg"
                or path == regions["path"]
                or re.fullmatch(r"assets/[A-Za-z0-9_.-]+\.(js|css|woff2|png|jpg|svg)", path)):
            raise ValueError(f"unexpected site file: {path}")
    return receipt


def build(config_path: Path, output: Path) -> dict:
    repo = canonical_host()
    if output.exists():
        raise ValueError("site output must be a new directory")
    config_path = config_path.resolve()
    subprocess.run(["git", "ls-files", "--error-unmatch", "--", str(config_path.relative_to(REPOSITORY))],
                   cwd=REPOSITORY, check=True, capture_output=True)
    config = json.loads(config_path.read_bytes())
    node = subprocess.run(["node", "--version"], check=True, text=True, capture_output=True).stdout.strip()
    if not node.startswith("v22."):
        raise ValueError("site builds require Node 22")
    receipt = {"commit": repo.commit, "environment": build_environment(), "node": node, "config": config}
    identity = hashlib.sha256(json_bytes(receipt)).hexdigest()[:32]
    receipt.update(format="atlas-site-build-v1", build_id=identity, dependencies=dependencies(config))
    with tempfile.TemporaryDirectory(prefix="atlas-site-build-") as temporary:
        root = Path(temporary) / "site"
        subprocess.run(["npm", "run", "build", "--", "--base", f"/site/builds/{identity}/",
                        "--outDir", str(root)], cwd=REPOSITORY / "web", check=True,
                       env=build_environment_for_site(config, identity))
        for relative in ("favicon.png", "brand/ibl-core-logo.svg", atlas_regions(config)["path"]):
            source = REPOSITORY / "web/public" / relative
            subprocess.run(["git", "ls-files", "--error-unmatch", "--", str(source.relative_to(REPOSITORY))],
                           cwd=REPOSITORY, check=True, capture_output=True)
            if source.is_symlink() or not source.is_file():
                raise ValueError(f"site asset is not a tracked regular file: {relative}")
            target = root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
        regions = atlas_regions(config)
        if file_info(root / regions["path"]) != {"size": regions["bytes"], "sha256": regions["sha256"]}:
            raise ValueError("tracked atlas_regions source differs from the site descriptor")
        receipt["files"] = {p.relative_to(root).as_posix(): file_info(p) for p in root.rglob("*") if p.is_file()}
        (root / "_site.json").write_bytes(json_bytes(receipt))
        validate_site(root, repo)
        shutil.copytree(root, output)
    return receipt


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("config", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args(argv)
    try:
        result = build(args.config, args.output)
    except (ValueError, RuntimeError, OSError, subprocess.CalledProcessError) as error:
        parser.exit(1, f"site build failed: {error}\n")
    print(json.dumps({"build_id": result["build_id"], "files": len(result["files"])}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
