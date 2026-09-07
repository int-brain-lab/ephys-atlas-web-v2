"""Build a clean Linux site with explicit same-origin deployment dependencies."""
from __future__ import annotations

import argparse
import hashlib
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


def dependencies(config: dict) -> list[dict]:
    if set(config) not in ({"catalog", "projection"}, {"catalog", "projection", "mesh"}):
        raise ValueError("site config requires catalog/projection and optional mesh")
    result = []
    for kind, descriptor in config.items():
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


def build_environment_for_site(config: dict) -> dict[str, str]:
    dependencies(config)
    environment = {k: v for k, v in os.environ.items() if not k.startswith(("VITE_", "EPHYS_ATLAS_", "AGEA_"))}
    environment.update(EPHYS_ATLAS_SITE_BUILD="1", VITE_DATASET_CATALOG_URL="/catalog.json",
                       VITE_PROJECTION_PACK_URL="/" + config["projection"]["path"])
    if "mesh" in config:
        environment.update(VITE_BRAIN_MESH_MANIFEST_URL="/" + config["mesh"]["path"],
                           VITE_BRAIN_MESH_MANIFEST_BYTES=str(config["mesh"]["bytes"]),
                           VITE_BRAIN_MESH_MANIFEST_SHA256=config["mesh"]["sha256"])
    return environment


def validate_site(root: Path, repo) -> dict:
    receipt = json.loads((root / "_site.json").read_bytes())
    if receipt.get("format") != "atlas-site-build-v1" or receipt.get("commit") != repo.commit or receipt.get("environment") != build_environment():
        raise ValueError("site requires exact current Linux build provenance")
    expected_dependencies = dependencies(receipt["config"])
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
    for url in re.findall(r'(?:src|href)="([^"]+)"', html):
        if not url.startswith(base) or url[len(base):] not in actual:
            raise ValueError("site HTML references a missing or non-build asset")
    for path in actual:
        if not (path == "index.html" or path == "favicon.png" or path == "brand/ibl-core-logo.svg" or re.fullmatch(r"assets/[A-Za-z0-9_.-]+\.(js|css|woff2|png|svg)", path)):
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
                       env=build_environment_for_site(config))
        for relative in ("favicon.png", "brand/ibl-core-logo.svg"):
            target = root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(REPOSITORY / "web/public" / relative, target)
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
