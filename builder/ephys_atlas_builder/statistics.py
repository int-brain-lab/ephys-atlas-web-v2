from __future__ import annotations

import numpy as np


SUMMARY_FIELDS = ["count", "missing_count", "min", "max", "mean", "std", "median", "q05", "q25", "q75", "q95"]


def describe(values: np.ndarray) -> dict[str, float | int | None]:
    values = np.asarray(values, dtype=np.float64)
    finite = values[np.isfinite(values)]
    missing = values.size - finite.size
    if finite.size == 0:
        return {
            "count": 0,
            "missing_count": int(missing),
            "min": None,
            "max": None,
            "mean": None,
            "std": None,
            "median": None,
            "q05": None,
            "q25": None,
            "q75": None,
            "q95": None,
        }
    q05, q25, q50, q75, q95 = np.quantile(finite, [0.05, 0.25, 0.5, 0.75, 0.95])
    return {
        "count": int(finite.size),
        "missing_count": int(missing),
        "min": float(finite.min()),
        "max": float(finite.max()),
        "mean": float(finite.mean()),
        "std": float(finite.std(ddof=0)),
        "median": float(q50),
        "q05": float(q05),
        "q25": float(q25),
        "q75": float(q75),
        "q95": float(q95),
    }


def summary_matrix(groups: list[np.ndarray]) -> np.ndarray:
    out = np.empty((len(groups), len(SUMMARY_FIELDS)), dtype=np.float64)
    for i, group in enumerate(groups):
        stats = describe(group)
        out[i] = [np.nan if stats[k] is None else float(stats[k]) for k in SUMMARY_FIELDS]
    return out


def histogram(values: np.ndarray, edges: np.ndarray) -> np.ndarray:
    finite = np.asarray(values, dtype=np.float64)
    finite = finite[np.isfinite(finite)]
    return np.histogram(finite, bins=edges)[0].astype(np.uint32)
