"""Offline, evidence-first anatomy smoothing experiment tooling."""

from .metrics import EvaluationPolicy, ExperimentMetrics, measure_candidate
from .strategies import (
    Eligibility,
    ExperimentResult,
    available_strategies,
    parse_tolerances_um,
    run_experiment,
)

__all__ = [
    "Eligibility",
    "EvaluationPolicy",
    "ExperimentMetrics",
    "ExperimentResult",
    "available_strategies",
    "measure_candidate",
    "parse_tolerances_um",
    "run_experiment",
]
