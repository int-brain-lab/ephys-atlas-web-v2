from __future__ import annotations

import hashlib
import json
import re
import shutil
from pathlib import Path

from .io import canonical_json, sha256_file, write_json


DEFAULTS = {
    "ephys_atlas_channels": {"project": "ea_active"},
    "ephys_atlas_volumes": {"project": "ea_active"},
    "ephys_atlas_clusters": {},
}
_LABEL_RE = re.compile(r"^\d{4}_W\d{2}$")


def _files(root: Path) -> list[dict]:
    out = []
    for path in sorted(
        p for p in root.rglob("*") if p.is_file() and p.name != "source.json"
    ):
        out.append(
            {
                "path": path.relative_to(root).as_posix(),
                "bytes": path.stat().st_size,
                "sha256": sha256_file(path),
            }
        )
    return out


def _content_release_id(files: list[dict]) -> str:
    digest = hashlib.sha256(canonical_json(files)).hexdigest()
    return f"sha256-{digest[:16]}"


def _write_alias(dest: Path, dataset: str, alias: str, release_id: str) -> None:
    write_json(
        dest / dataset / "aliases" / f"{alias}.json",
        {
            "schema_version": "1.0",
            "dataset_id": dataset,
            "alias": alias,
            "release_id": release_id,
        },
    )


def resolve_source_release(dest: Path, dataset: str, release: str) -> str:
    if release != "latest":
        return release
    path = dest / dataset / "aliases" / "latest.json"
    if not path.is_file():
        raise RuntimeError(f"no pulled latest alias for {dataset}: run data-pull first")
    return json.loads(path.read_text())["release_id"]


def _encoding_volume_labels(s3, bucket_name: str, project: str) -> list[str]:
    """List weekly vintages from the encoding-volume prefix itself.

    Channel-feature and encoding-volume vintages are independent catalogs. Do not
    resolve a volume `latest` through `ephysatlas.data.get_latest_label()`, which
    currently lists the channel-feature prefix.
    """
    prefix = f"aggregates/atlas/encoding_volumes/{project}/"
    labels = set()
    for obj in s3.Bucket(bucket_name).objects.filter(Prefix=prefix):
        suffix = obj.key[len(prefix) :]
        label = suffix.split("/", 1)[0]
        if _LABEL_RE.fullmatch(label):
            labels.add(label)
    return sorted(labels, reverse=True)


def _latest_encoding_volume_label(s3, bucket_name: str, project: str) -> str:
    labels = _encoding_volume_labels(s3, bucket_name, project)
    if not labels:
        raise RuntimeError(
            f"no encoding-volume vintages found under "
            f"aggregates/atlas/encoding_volumes/{project}/"
        )
    return labels[0]


def _canonical_source(
    dataset: str, bucket_name: str, project: str, release: str
) -> dict:
    if dataset == "ephys_atlas_channels":
        key = f"aggregates/atlas/features/{project}/{release}/agg_full/"
        return {
            "bucket": bucket_name,
            "prefix": key,
            "uri": f"s3://{bucket_name}/{key}",
        }
    if dataset == "ephys_atlas_volumes":
        key = (
            f"aggregates/atlas/encoding_volumes/{project}/{release}/"
            "brainwide_ephys_atlas_25um.npz"
        )
        return {"bucket": bucket_name, "key": key, "uri": f"s3://{bucket_name}/{key}"}
    if dataset == "ephys_atlas_clusters":
        key = f"aggregates/atlas/projects/{project}/"
        return {
            "bucket": bucket_name,
            "prefix": key,
            "uri": f"s3://{bucket_name}/{key}",
        }
    raise ValueError(dataset)


def pull(
    dataset: str,
    release: str,
    dest: Path,
    *,
    project: str | None = None,
) -> Path:
    """Snapshot current canonical scientific artifacts without recomputing science.

    The returned directory is immutable by convention and contains `source.json`
    with checksums for every downloaded file. A request for `latest` additionally
    updates a small mutable alias outside that snapshot directory. Cluster source
    paths lack a vintage upstream, so their immutable release id is content-derived.
    """
    if dataset not in DEFAULTS:
        if dataset == "brainwide_map":
            raise RuntimeError(
                "brainwide_map v2 source selection is unresolved: do not guess between the paper freeze, "
                "2026 aggregate tables, and legacy website analysis summaries; see docs/data/PROVENANCE.md"
            )
        if dataset == "local":
            raise RuntimeError(
                "local datasets are imported packages, not remotely pulled datasets"
            )
        raise ValueError(f"unknown dataset: {dataset}")

    if dataset == "ephys_atlas_clusters":
        if not project:
            raise RuntimeError(
                "pulling ephys_atlas_clusters requires an explicit --project; "
                "the launch cohort must not be inferred from a historical default"
            )
    elif project is not None:
        raise ValueError(
            f"--project is only configurable for ephys_atlas_clusters; {dataset} uses its canonical project"
        )

    try:
        from one.api import ONE
        from one.remote import aws
        import ephysatlas.data
    except ImportError as e:
        raise RuntimeError(
            "pulling IBL scientific sources requires ONE + current ibleatools/ephysatlas; "
            "install them in the scientific-data environment"
        ) from e

    one = ONE(base_url="https://alyx.internationalbrainlab.org", mode="remote")
    s3, bucket_name = aws.get_s3_from_alyx(alyx=one.alyx)
    project = project or DEFAULTS[dataset]["project"]
    requested_release = release

    if dataset == "ephys_atlas_clusters":
        if release not in ("latest", "current"):
            raise RuntimeError(
                "ephys_atlas_clusters source objects are not vintage-labelled in current ibleatools; "
                "use latest/current and v2 will assign a content-derived immutable snapshot id"
            )
        staging = dest / dataset / ".pull-current"
        if staging.exists():
            shutil.rmtree(staging)
        staging.mkdir(parents=True)
        ephysatlas.data.download_project_data(
            staging, project=project, one=one, large_files=False
        )
        files = _files(staging)
        release = _content_release_id(files)
        root = dest / dataset / release
        if root.exists():
            shutil.rmtree(staging)
        else:
            staging.rename(root)
    else:
        if release == "latest":
            if dataset == "ephys_atlas_volumes":
                release = _latest_encoding_volume_label(s3, bucket_name, project)
            else:
                release = ephysatlas.data.get_latest_label(one=one, project=project)
        root = dest / dataset / str(release)
        root.mkdir(parents=True, exist_ok=True)
        if dataset == "ephys_atlas_channels":
            ephysatlas.data.download_tables(
                root, label=release, project=project, one=one, verify=True
            )
        else:
            ephysatlas.data.download_encoding_volume(
                root, label=release, project=project, one=one
            )
        files = _files(root)

    source = {
        "schema_version": "1.0",
        "dataset_id": dataset,
        "requested_release": requested_release,
        "resolved_release": str(release),
        "project": project,
        "canonical_source": _canonical_source(
            dataset, bucket_name, project, str(release)
        ),
        "files": files,
    }
    write_json(root / "source.json", source)
    if requested_release == "latest":
        _write_alias(dest, dataset, "latest", str(release))
    return root
