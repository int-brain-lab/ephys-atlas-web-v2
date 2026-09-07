"""Exploratory AGEA scores; never a production validity mask or repair recipe.

Slab contrast compares missing fractions in a projected interval and BOTH
adjacent shoulders. A hemisphere step therefore is not an internal slab.
All distances are source-grid voxels (200 um for the pinned AGEA source).
"""
from __future__ import annotations

from dataclasses import dataclass
from itertools import product

import numpy as np
from scipy import ndimage


@dataclass(frozen=True)
class Parameters:
    erosion: int = 1
    widths: tuple[int, ...] = (1, 2, 3)
    min_support: int = 100
    slopes: tuple[float, ...] = (-1., -.5, -.25, -.125, 0., .125, .25, .5, 1.)


def normals(slopes: tuple[float, ...]) -> np.ndarray:
    """Deterministic hemisphere of directions; includes tilted planes in 3-D."""
    result = {}
    for axis in range(3):
        for a, b in product(slopes, repeat=2):
            n = np.insert(np.array([a, b]), axis, 1.)
            n /= np.linalg.norm(n)
            if n[np.flatnonzero(n)[0]] < 0:
                n = -n
            result[tuple(np.round(n, 8))] = n
    return np.array(list(result.values()))


def fraction(mask: np.ndarray, population: np.ndarray) -> float | None:
    count = int(population.sum())
    return float(np.count_nonzero(mask & population) / count) if count else None


class Screen:
    """Precompute population projections once, then stream one volume at a time."""

    def __init__(self, labels: np.ndarray, parameters: Parameters = Parameters()):
        if labels.ndim != 3 or parameters.erosion < 0 or parameters.min_support < 1:
            raise ValueError("Expected 3-D labels and nonnegative erosion / positive support")
        if not parameters.widths or any(w < 1 for w in parameters.widths):
            raise ValueError("Slab widths must be positive")
        self.parameters = parameters
        self.labels = labels
        self.mask = labels != 0
        self.interior = (ndimage.binary_erosion(self.mask, iterations=parameters.erosion)
                         if parameters.erosion else self.mask.copy())
        self.coords = np.argwhere(self.interior)
        self.directions = normals(parameters.slopes)
        self.projections = []
        for normal in self.directions:
            projection = self.coords @ normal
            offset = int(np.floor(projection.min())) if projection.size else 0
            bins = np.floor(projection - offset).astype(np.int32)
            support = np.bincount(bins)
            self.projections.append((bins, support, offset))

    def slab(self, missing: np.ndarray) -> dict:
        selected = missing[self.interior]
        best = dict(score=None, normal=None, start=None, width=None,
                    missing_fraction=None, shoulder_fraction=None, support=0,
                    missing_support=0, residual_rms_voxels=None)
        for normal, (bins, counts, offset) in zip(self.directions, self.projections):
            hits = np.bincount(bins[selected], minlength=len(counts))
            for width in self.parameters.widths:
                if len(counts) < 3 * width:
                    continue
                den = np.convolve(counts, np.ones(width, dtype=int), mode="valid")
                num = np.convolve(hits, np.ones(width, dtype=int), mode="valid")
                rates = np.divide(num, den, out=np.zeros(len(num)), where=den > 0)
                center = rates[width:-width]
                shoulders = np.maximum(rates[:-2 * width], rates[2 * width:])
                supported = ((den[width:-width] >= self.parameters.min_support)
                             & (den[:-2 * width] >= self.parameters.min_support)
                             & (den[2 * width:] >= self.parameters.min_support))
                if not supported.any():
                    continue
                score = np.where(supported, np.maximum(0., center - shoulders), -1.)
                index = int(np.argmax(score))
                if best["score"] is None or score[index] > best["score"]:
                    start = index + width
                    hit_coords = self.coords[selected & (bins >= start) & (bins < start + width)]
                    residual = hit_coords @ normal - (offset + start + width / 2)
                    best = dict(score=float(score[index]), normal=normal.tolist(),
                                start=float(offset + start), width=width,
                                missing_fraction=float(center[index]),
                                shoulder_fraction=float(shoulders[index]), support=int(den[start]),
                                missing_support=int(num[start]),
                                residual_rms_voxels=float(np.sqrt(np.mean(residual ** 2)))
                                if residual.size else None)
        return best

    def intensity(self, values: np.ndarray) -> dict:
        """Region-centered log1p means: exploratory composition control, not QC.

        Center each supplied region over measured interior voxels. Clip residuals
        at +/-3 log units, then require >=min_support per three adjacent slices.
        A constant or linear log gradient has zero second difference. Measured
        zeros enter log1p as zero; -1 never enters an intensity statistic.
        """
        valid = self.interior & np.isfinite(values) & (values >= 0)
        if not valid.any():
            return dict(score=None, axis=None, index=None, profiles=[[], [], []])
        coords = np.argwhere(valid)
        _, regions = np.unique(self.labels[valid], return_inverse=True)
        logvalues = np.log1p(values[valid].astype(float))
        counts = np.bincount(regions)
        means = np.bincount(regions, weights=logvalues) / counts
        residual = np.clip(logvalues - means[regions], -3., 3.)
        best = dict(score=None, axis=None, index=None, profiles=[])
        for axis, length in enumerate(values.shape):
            den = np.bincount(coords[:, axis], minlength=length)
            num = np.bincount(coords[:, axis], weights=residual, minlength=length)
            profile = np.divide(num, den, out=np.zeros(length), where=den > 0)
            supported = den >= self.parameters.min_support
            best["profiles"].append([float(x) if ok else None for x, ok in zip(profile, supported)])
            eligible = supported[:-2] & supported[1:-1] & supported[2:]
            if eligible.any():
                changes = np.where(eligible, abs(np.diff(profile, n=2)) / 2, -1.)
                index = int(np.argmax(changes))
                if best["score"] is None or changes[index] > best["score"]:
                    best.update(score=float(changes[index]), axis=axis, index=index + 1)
        return best

    def score(self, values: np.ndarray) -> dict:
        if values.shape != self.labels.shape:
            raise ValueError("Volume and labels must have equal shape")
        if np.any(~np.isfinite(values) | ((values < 0) & (values != -1))):
            raise ValueError("Unexpected source values; only -1 is treated as missing")
        missing = values == -1
        components, count = ndimage.label(missing & self.interior)
        sizes = np.bincount(components.ravel())[1:]
        profiles = []
        for axis in range(3):
            others = tuple(i for i in range(3) if i != axis)
            den = self.interior.sum(axis=others)
            num = (missing & self.interior).sum(axis=others)
            profiles.append([float(n / d) if d else None for n, d in zip(num, den)])
        return dict(missing_all=float(missing.mean()), missing_labelled=fraction(missing, self.mask),
                    missing_interior=fraction(missing, self.interior),
                    missing_boundary=fraction(missing, self.mask & ~self.interior),
                    interior_support=int(self.interior.sum()),
                    largest_connected_gap=int(sizes.max()) if count else 0,
                    missing_profiles=profiles, slab=self.slab(missing), intensity=self.intensity(values))


def synthetic_cases(shape: tuple[int, int, int] = (31, 29, 33)) -> tuple[np.ndarray, dict]:
    """Declared controls fixed before inspecting real-data score rankings."""
    coords = np.indices(shape)
    mask = sum(((coords[a] - (shape[a] - 1) / 2) / (shape[a] / 2 - 2)) ** 2
               for a in range(3)) < 1
    labels = mask.astype(int)
    base = np.ones(shape, dtype=float)
    cases = {"constant": base.copy()}
    projection = coords[0] + .5 * coords[1] - .5 * coords[2]
    midpoint = (shape[0] - 1) / 2 + .5 * (shape[1] - shape[2]) / 2
    for width in (1, 2, 3):
        v = base.copy()
        v[abs(projection - midpoint) < width / 2 * np.sqrt(1.5)] = -1
        cases[f"tilted_slab_{width}"] = v
    shallow = coords[2] + .125 * coords[0]
    v = base.copy()
    v[abs(shallow - (shape[2] - 1) / 2 - .125 * (shape[0] - 1) / 2) < .5] = -1
    cases["shallow_slab"] = v
    v = base.copy()
    v[np.random.default_rng(7).random(shape) < .12] = -1
    cases["random_missing"] = v
    v = base.copy()
    v[mask & ~ndimage.binary_erosion(mask)] = -1
    cases["boundary_only"] = v
    v = base.copy()
    v[coords[0] < shape[0] // 2] = -1
    cases["hemisphere"] = v
    cases["log_gradient"] = np.expm1(.02 * coords[2])
    cases["intensity_bands"] = np.where(coords[2] % 2, 1., 8.)
    cases["regional_boundary"] = np.where(coords[0] < shape[0] // 2, 1., 8.)
    cases["misstrided_slab"] = cases["tilted_slab_2"].ravel().reshape(shape, order="F")
    return labels, cases
