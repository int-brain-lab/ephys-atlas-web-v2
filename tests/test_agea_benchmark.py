"""Transport audit mechanics; no real AGEA data is required by the local gate."""

import hashlib

import numpy as np
import pytest

from tools.agea_benchmark import slice_checksums, value_counts, verify


def test_categories_partition_values_and_do_not_confuse_zero_with_missing():
    values = np.array([-1, -2, 0, 3, np.nan, np.inf, -1, 0])
    inside = np.array([True] * 6 + [False] * 2)
    counts = value_counts(values, inside)
    assert sum(counts.values()) == len(values)
    assert counts["label_nonzero_nonfinite"] == 2
    assert counts["label_nonzero_other_negative"] == 1
    assert counts["label_zero_minus_one"] == counts["label_zero_zero"] == 1


def test_slice_oracle_retains_distinct_axis_order():
    values = np.arange(3 * 4 * 5).reshape(3, 4, 5)
    expected = {
        "coronal": [values[ml, dv, 2] for dv in range(4) for ml in range(3)],
        "sagittal": [values[1, dv, ap] for dv in range(4) for ap in range(5)],
        "horizontal": [values[ml, 2, ap] for ap in range(5) for ml in range(3)],
    }
    assert slice_checksums(values) == {
        axis: hashlib.sha256(np.array(plane, dtype="<f4").tobytes()).hexdigest()
        for axis, plane in expected.items()
    }


def test_changed_source_fails_before_decode(tmp_path):
    source = tmp_path / "source.bin"
    source.write_bytes(b"changed")
    with pytest.raises(ValueError, match="Source hash mismatch"):
        verify(source, hashlib.sha256(b"original").hexdigest())
