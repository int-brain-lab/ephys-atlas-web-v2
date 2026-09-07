"""Direct Allen archive verification mechanics use only synthetic inputs."""

import io
import json
import zipfile

import numpy as np
import pytest

from tools.agea_source_verification import read_allen_archive, verify_experiment


def _archive(tmp_path, *, dimensions=(4, 3, 2), element_type="MET_FLOAT",
             byte_order="False", raw=None):
    path = tmp_path / "allen.zip"
    shape = tuple(reversed(dimensions))
    source = np.arange(np.prod(shape), dtype="<f4").reshape(shape)
    raw = source.tobytes() if raw is None else raw
    header = (
        "ObjectType = Image\n"
        "NDims = 3\n"
        "BinaryData = True\n"
        f"BinaryDataByteOrderMSB = {byte_order}\n"
        f"DimSize = {' '.join(map(str, dimensions))}\n"
        f"ElementType = {element_type}\n"
        "ElementDataFile = energy.raw\n"
    )
    xml = """<section-data-set>
      <alignment3d><id>7</id><trv>1,2,3</trv><tvr>4,5,6</tvr></alignment3d>
      <section-images>
        <section-image><section-number>18</section-number></section-image>
        <section-image><section-number>26</section-number></section-image>
      </section-images>
    </section-data-set>"""
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("energy.mhd", header)
        archive.writestr("energy.raw", raw)
        archive.writestr("data_set.xml", xml)
    return path, source, header


def test_read_reverses_unequal_header_dimensions_and_records_evidence(tmp_path):
    path, expected, header = _archive(tmp_path, dimensions=(4, 3, 2))
    volume, evidence = read_allen_archive(path)
    assert volume.flags.c_contiguous
    assert volume.shape == (2, 3, 4)
    assert volume[1, 2, 3] == expected[1, 2, 3] == 23
    assert evidence["metaimage"]["original_header"] == header
    assert evidence["metaimage"]["header_dimensions"] == [4, 3, 2]
    assert evidence["xml"] == {
        "section_numbers": [18, 26],
        "alignment3d": {"id": "7", "trv": "1,2,3", "tvr": "4,5,6"},
    }
    assert set(evidence["members"]) == {"energy.mhd", "energy.raw", "data_set.xml"}
    json.dumps(evidence, allow_nan=False)


@pytest.mark.parametrize(
    ("kwargs", "message"),
    [
        ({"element_type": "MET_DOUBLE"}, "ElementType"),
        ({"byte_order": "True"}, "BinaryDataByteOrderMSB"),
        ({"raw": b"too short"}, "raw length mismatch"),
    ],
)
def test_rejects_unsupported_dtype_endian_and_length(tmp_path, kwargs, message):
    path, _, _ = _archive(tmp_path, **kwargs)
    with pytest.raises(ValueError, match=message):
        read_allen_archive(path)


def test_verify_reports_full_and_struct_selected_comparisons(tmp_path):
    path, source, _ = _archive(tmp_path)
    values = source.astype("<f2")
    evidence = verify_experiment(path, values)
    comparison = evidence["comparison"]
    assert comparison["float16_full_volume_equal"] is True
    assert comparison["float16_mismatch_count"] == 0
    assert [item["flat_index"] for item in comparison["selected_voxels"]] == [0, 12, 23]
    assert comparison["selected_voxels"][-1]["coordinate"] == [1, 2, 3]
    json.dumps(evidence, allow_nan=False)

    values[1, 2, 3] = -1
    mismatch = verify_experiment(path, values)["comparison"]
    assert mismatch["float16_full_volume_equal"] is False
    assert mismatch["float16_mismatch_count"] == 1
    assert mismatch["selected_voxels"][-1]["float16_equal"] is False


def test_rejects_shape_mismatch_and_unsafe_member(tmp_path):
    path, source, _ = _archive(tmp_path)
    with pytest.raises(ValueError, match="shape mismatch"):
        verify_experiment(path, source.ravel())

    with zipfile.ZipFile(path, "a") as archive:
        archive.writestr("../unexpected", io.BytesIO(b"unsafe").getvalue())
    with pytest.raises(ValueError, match="Unsafe ZIP member"):
        read_allen_archive(path)
