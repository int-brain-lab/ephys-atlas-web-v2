import struct

import pytest

from tools.svg_pack import SvgFragment, SvgPack, decode, encode


def sample() -> SvgPack:
    return SvgPack(
        "coronal",
        "synthetic-pack",
        (
            SvgFragment(4, 100.0, '<path id="a"/>'),
            SvgFragment(9, 225.5, '<path id="β"/>'),
        ),
    )


def test_round_trip_is_deterministic():
    packed = encode(sample())
    assert packed == encode(sample())
    assert decode(packed) == sample()


@pytest.mark.parametrize("mutate", [lambda b: b[:3], lambda b: b[:4] + b"X" + b[5:], lambda b: b[:-1]])
def test_rejects_malformed_pack(mutate):
    with pytest.raises(ValueError):
        decode(mutate(encode(sample())))


def test_rejects_invalid_utf8_fragment():
    packed = bytearray(encode(sample()))
    packed[-1] = 0xFF
    with pytest.raises(ValueError, match="UTF-8"):
        decode(packed)


def test_rejects_duplicate_or_unsorted_slice_indices():
    duplicate = SvgPack(
        "coronal",
        "synthetic-pack",
        (SvgFragment(4, 100.0, "a"), SvgFragment(4, 110.0, "b")),
    )
    unsorted = SvgPack(
        "coronal",
        "synthetic-pack",
        (SvgFragment(9, 100.0, "a"), SvgFragment(4, 110.0, "b")),
    )
    with pytest.raises(ValueError, match="strictly increasing"):
        encode(duplicate)
    with pytest.raises(ValueError, match="strictly increasing"):
        encode(unsorted)
