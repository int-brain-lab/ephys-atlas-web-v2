"""Independent section-coordinate oracle, without real AGEA or network inputs."""
import zipfile

import numpy as np
import pytest

from tools.agea_stripe_report import section_evidence


def test_section_axis_uses_row_major_trv_and_header_axis_order(tmp_path):
    archive = tmp_path / "source.zip"
    header = "ElementSpacing = 200 200 200\nOffset = 0 0 0\nTransformMatrix = 1 0 0 0 1 0 0 0 1\n"
    # Specimen z = reference x (AP), proving that array ML is NOT header x.
    xml = """<section-data-set><id>1</id><section-thickness>25</section-thickness>
    <alignment3d><trv>0,0,1,0,1,0,1,0,0,0,0,0</trv>
    <tvr>0,0,1,0,1,0,1,0,0,0,0,0</tvr></alignment3d>
    <section-images><section-image><section-number>0</section-number></section-image>
    <section-image><section-number>8</section-number></section-image>
    <section-image><section-number>24</section-number></section-image>
    <section-image><section-number>32</section-number></section-image></section-images></section-data-set>"""
    with zipfile.ZipFile(archive, "w") as z:
        z.writestr("energy.mhd", header)
        z.writestr("data_set.xml", xml)
    values = np.ones((7, 6, 5))
    values[:, :, 2] = -1
    evidence = section_evidence(archive, values, np.ones_like(values))
    assert evidence["absent_numbers"] == [16]
    assert evidence["roundtrip_max_error_um"] == pytest.approx(0)
    section = next(r for r in evidence["sections"] if r["number"] == 16)
    assert section["labelled"] == dict(support=42, missing=42, fraction=1.)
    assert section["interior"] == dict(support=20, missing=20, fraction=1.)
    assert all(r["labelled"]["missing"] == 0 for r in evidence["sections"] if r["present"])
