"""Coverage lab preparation must not turn changed sources into reviewed data."""
import pytest

from tools.agea_coverage_lab import build


def test_coverage_lab_rejects_changed_source_before_reading_transport(tmp_path):
    source = tmp_path / "source"
    source.mkdir()
    (source / "gene-expression.bin").write_bytes(b"not the pinned source")
    output = tmp_path / "transport"
    with pytest.raises(ValueError, match="Source hash mismatch"):
        build(source, output)
    assert not output.exists()
