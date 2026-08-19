from __future__ import annotations

from pathlib import Path


DEFAULTS = {
    "ephys_atlas_channels": {"project": "ea_active"},
    "ephys_atlas_volumes": {"project": "ea_active"},
    "ephys_atlas_clusters": {"project": "ibl_neuropixel_brainwide_01"},
}


def pull(dataset: str, release: str, dest: Path) -> Path:
    """Pull canonical scientific source artifacts without running the scientific pipeline.

    This intentionally delegates to the current scientific packages. The v2 builder
    records and transforms their published artifacts; it does not reproduce raw-ephys
    feature extraction during frontend development.
    """
    dest.mkdir(parents=True, exist_ok=True)
    if dataset in ("ephys_atlas_channels", "ephys_atlas_volumes", "ephys_atlas_clusters"):
        try:
            from one.api import ONE
            import ephysatlas.data
        except ImportError as e:
            raise RuntimeError(
                "pulling IBL scientific sources requires ONE + current ibleatools/ephysatlas; "
                "install them in the scientific-data environment"
            ) from e
        one = ONE(base_url="https://alyx.internationalbrainlab.org", mode="remote")
        project = DEFAULTS[dataset]["project"]
        label = ephysatlas.data.get_latest_label(one=one, project=project) if release == "latest" and dataset != "ephys_atlas_clusters" else release
        if dataset == "ephys_atlas_channels":
            return Path(ephysatlas.data.download_tables(dest, label=label, project=project, one=one, verify=True))
        if dataset == "ephys_atlas_volumes":
            out = dest / project / str(label)
            out.mkdir(parents=True, exist_ok=True)
            return Path(ephysatlas.data.download_encoding_volume(out, label=label, project=project, one=one))
        if release not in ("latest", "current"):
            raise RuntimeError(
                "ephys_atlas_clusters source objects are not weekly-labelled in current ibleatools; "
                "use latest/current, then snapshot object checksums into the immutable v2 release"
            )
        return Path(ephysatlas.data.download_project_data(dest, project=project, one=one, large_files=False))
    if dataset == "brainwide_map":
        raise RuntimeError(
            "brainwide_map v2 source selection is unresolved: do not guess between the paper freeze, "
            "2026 aggregate tables, and legacy website analysis summaries; see docs/data/PROVENANCE.md"
        )
    if dataset == "local":
        raise RuntimeError("local datasets are imported packages, not remotely pulled datasets")
    raise ValueError(f"unknown dataset: {dataset}")
