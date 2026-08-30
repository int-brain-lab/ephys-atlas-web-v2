"""Deterministic corpus generation for opt-in local-import measurements."""

from .corpus import (
    CapacityCase,
    ReleaseCase,
    generate_adversarial_corpus,
    generate_capacity_corpus,
    generate_real_corpus,
)

__all__ = [
    "CapacityCase",
    "ReleaseCase",
    "generate_adversarial_corpus",
    "generate_capacity_corpus",
    "generate_real_corpus",
]
