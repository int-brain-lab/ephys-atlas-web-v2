"""Experimental indexed binary transport for concatenated SVG fragments."""

from .codec import SvgFragment, SvgPack, decode, encode

__all__ = ["SvgFragment", "SvgPack", "decode", "encode"]
