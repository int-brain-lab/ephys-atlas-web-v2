"""Validate the artifact relationships of a site, separately from integrity.

Deployment snapshots are exact served manifest bytes, addressed by SHA-256.
The artifact profile is also consumed by Vite: requirements come from the
companion selected for the browser, rather than a second dependency list.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from urllib.request import urlopen

from ephys_atlas_builder.schema_v1 import validate_schema_v1_document

REPOSITORY = Path(__file__).resolve().parents[1]
SNAPSHOTS = Path("data/deployment/dependencies")
SCHEMAS = {"catalog": "catalog.schema.json", "projection": "projection-pack.schema.json", "mesh": "mesh-pack.schema.json"}


def verified_document(raw: bytes, descriptor: dict, name: str) -> dict:
    if len(raw) != descriptor["bytes"] or hashlib.sha256(raw).hexdigest() != descriptor["sha256"]:
        raise ValueError(f"{name} manifest integrity differs from deployment descriptor")
    return json.loads(raw)


def navigation_path(profile: str, repository: Path = REPOSITORY) -> Path:
    profiles = json.loads((repository / "web/artifact-profiles.json").read_bytes())
    relative = Path(profiles[profile]["navigation"])
    if relative.is_absolute() or ".." in relative.parts:
        raise ValueError("unsafe browser artifact profile")
    return repository / "web" / relative


def validate_navigation(nav: dict, projection: dict, projection_hash: str, regions: dict, regions_hash: str) -> None:
    validate_schema_v1_document(nav, "region-navigation.schema.json")
    if nav["projection_pack"] != {"pack_id": projection["pack_id"], "manifest_sha256": projection_hash}:
        raise ValueError("navigation companion requires a different projection pack/hash")
    if nav["reference_space_id"] != projection["reference_space_id"] or regions["reference_space_id"] != projection["reference_space_id"]:
        raise ValueError("navigation/projection/regions reference spaces differ")
    coronal = next(p for p in projection["projections"] if p["id"] == "coronal")
    grid = nav["grid"]
    if (grid["shape"] != [coronal["slice_count"], *coronal["slice_shape"]]
            or grid["index_to_world_um"] != coronal["plane_index_to_world_um"]
            or grid["storage_axes"] != ["ap", "ml", "dv"]
            or any(p["reference_space_id"] != nav["reference_space_id"] or p["grid_id"] != grid["grid_id"]
                   for p in projection["projections"] if p["kind"] == "registered-slice-stack")):
        raise ValueError("navigation grid/affine differs from registered projection geometry")
    sources = nav["provenance"]["sources"]
    if not any(s.get("path") == "regions.json" and s.get("sha256") == regions_hash for s in sources):
        raise ValueError("navigation signed mappings differ from the bundled region catalog")


def validate_catalog_links(catalog: dict) -> None:
    """Schema validation alone cannot establish cross-entry discovery identities."""
    validate_schema_v1_document(catalog, "catalog.schema.json")


def check_compatibility(config: dict, *, repository: Path = REPOSITORY, profile: str = "production",
                        origin: str | None = None, catalog_candidate: Path | None = None) -> dict:
    documents = {}
    for role, schema in SCHEMAS.items():
        if role not in config:
            continue
        descriptor = config[role]
        if origin:
            with urlopen(origin.rstrip("/") + "/" + descriptor["path"], timeout=60) as response:
                raw = response.read()
        else:
            raw = (repository / SNAPSHOTS / (descriptor["sha256"] + ".json")).read_bytes()
        documents[role] = verified_document(raw, descriptor, role)
        validate_schema_v1_document(documents[role], schema)
    regions_descriptor = config["atlas_regions"]
    regions_raw = (repository / "web/public" / regions_descriptor["path"]).read_bytes()
    regions = verified_document(regions_raw, regions_descriptor, "regions")
    nav_path = navigation_path(profile, repository)
    nav_raw = nav_path.read_bytes()
    nav = json.loads(nav_raw)
    validate_navigation(nav, documents["projection"], config["projection"]["sha256"], regions, regions_descriptor["sha256"])
    for mapping, descriptor in nav["mappings"].items():
        raw = (nav_path.parent / descriptor["resource"]["path"]).read_bytes()
        resource = descriptor["resource"]
        if len(raw) != resource["bytes"] or hashlib.sha256(raw).hexdigest() != resource["sha256"]:
            raise ValueError(f"{mapping} navigation binary integrity differs")
    if "mesh" in documents:
        mesh = documents["mesh"]
        if mesh["purpose"] != "production" or mesh["reference_space_id"] != documents["projection"]["reference_space_id"]:
            raise ValueError("mesh purpose/reference space is incompatible with the production site")
    validate_catalog_links(documents["catalog"])
    if catalog_candidate:
        validate_catalog_links(json.loads(catalog_candidate.read_bytes()))
    return {"format": "atlas-site-compatibility-v1", "profile": profile,
            "navigation_sha256": hashlib.sha256(nav_raw).hexdigest(),
            "reference_space_id": nav["reference_space_id"],
            "dependencies": {role: config[role]["sha256"] for role in documents},
            "atlas_regions_sha256": regions_descriptor["sha256"]}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("config", type=Path)
    parser.add_argument("--origin", help="Also verify the exact configured manifest bytes on this origin")
    parser.add_argument("--catalog-candidate", type=Path, help="Check a proposed mutable catalog's schema and discovery links")
    args = parser.parse_args(argv)
    try:
        config = json.loads(args.config.read_bytes())
        from tools.site_build import dependencies
        dependencies(config)
        result = check_compatibility(config, origin=args.origin, catalog_candidate=args.catalog_candidate)
    except (ValueError, KeyError, OSError, RuntimeError) as error:
        parser.exit(1, f"site compatibility failed: {error}\n")
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
