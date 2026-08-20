import pytest

from ephys_atlas_builder.sources import (
    _canonical_source,
    _encoding_volume_labels,
    _latest_encoding_volume_label,
    pull,
)


class _Object:
    def __init__(self, key):
        self.key = key


class _Objects:
    def __init__(self, keys):
        self.keys = keys
        self.prefix = None

    def filter(self, Prefix):
        self.prefix = Prefix
        return [_Object(k) for k in self.keys if k.startswith(Prefix)]


class _Bucket:
    def __init__(self, objects):
        self.objects = objects


class _S3:
    def __init__(self, keys):
        self.objects = _Objects(keys)

    def Bucket(self, name):
        return _Bucket(self.objects)


def test_volume_latest_is_resolved_from_volume_catalog():
    prefix = "aggregates/atlas/encoding_volumes/ea_active/"
    s3 = _S3(
        [
            prefix + "2026_W12/brainwide_ephys_atlas_25um.npz",
            prefix + "2026_W09/brainwide_ephys_atlas_25um.npz",
            prefix + "README.txt",
            "aggregates/atlas/features/ea_active/2099_W52/agg_full/features.pqt",
        ]
    )
    assert _encoding_volume_labels(s3, "bucket", "ea_active") == [
        "2026_W12",
        "2026_W09",
    ]
    assert _latest_encoding_volume_label(s3, "bucket", "ea_active") == "2026_W12"
    assert s3.objects.prefix == prefix


def test_volume_latest_fails_when_volume_catalog_is_empty():
    with pytest.raises(RuntimeError, match="no encoding-volume vintages"):
        _latest_encoding_volume_label(_S3([]), "bucket", "ea_active")


def test_volume_source_records_exact_canonical_object():
    source = _canonical_source(
        "ephys_atlas_volumes",
        "ibl-brain-wide-map-private",
        "ea_active",
        "2026_W12",
    )
    assert source["uri"] == (
        "s3://ibl-brain-wide-map-private/aggregates/atlas/encoding_volumes/"
        "ea_active/2026_W12/brainwide_ephys_atlas_25um.npz"
    )


def test_cluster_pull_requires_explicit_project_before_remote_access(tmp_path):
    with pytest.raises(RuntimeError, match="explicit --project"):
        pull("ephys_atlas_clusters", "latest", tmp_path)


def test_other_pullers_do_not_accept_project_override(tmp_path):
    with pytest.raises(ValueError, match="only configurable"):
        pull("ephys_atlas_channels", "latest", tmp_path, project="ad-hoc")
