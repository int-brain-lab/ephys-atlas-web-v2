"""Deterministic controls for exploratory AGEA stripe screening."""

import hashlib

import numpy as np
import pytest

from tools.agea_benchmark import verify
from tools.agea_stripes import Parameters, Screen, synthetic_cases


PARAMETERS = Parameters(min_support=30)


@pytest.fixture(scope="module")
def controls():
    labels, cases = synthetic_cases()
    return labels, cases, Screen(labels, PARAMETERS)


def test_missing_slabs_separate_from_declared_missingness_controls(controls):
    _, cases, screen = controls
    slab_scores = [screen.score(cases[f"tilted_slab_{width}"])["slab"]["score"]
                   for width in (1, 2, 3)]
    control_scores = [screen.score(cases[name])["slab"]["score"]
                      for name in ("random_missing", "boundary_only", "hemisphere")]

    assert min(slab_scores) > 0.7
    assert max(control_scores) < 0.1


@pytest.mark.parametrize("width", (1, 2, 3))
def test_tilted_slab_recovers_width_and_direction_without_bank_identity(controls, width):
    _, cases, screen = controls
    result = screen.score(cases[f"tilted_slab_{width}"])["slab"]
    expected = np.array([1.0, 0.5, -0.5])
    expected /= np.linalg.norm(expected)

    # Projection binning makes the fitted width approximate. Direction is the
    # scientific property here, not the exact representative stored in a bank.
    assert abs(result["width"] - width) <= 1
    assert abs(np.dot(result["normal"], expected)) > 0.99
    assert result["residual_rms_voxels"] is not None


def test_erosion_removes_boundary_only_missingness_but_retains_internal_slab(controls):
    labels, cases, _ = controls
    results = {
        erosion: Screen(labels, Parameters(erosion=erosion, min_support=30))
        for erosion in (0, 1, 2)
    }

    assert results[0].score(cases["boundary_only"])["missing_interior"] > 0
    for erosion in (1, 2):
        boundary = results[erosion].score(cases["boundary_only"])
        slab = results[erosion].score(cases["tilted_slab_2"])
        assert boundary["missing_interior"] == 0
        assert slab["slab"]["score"] > 0.7


def test_intensity_bands_separate_from_constant_and_log_gradient(controls):
    _, cases, screen = controls
    band = screen.score(cases["intensity_bands"])["intensity"]
    constant = screen.score(cases["constant"])["intensity"]
    gradient = screen.score(cases["log_gradient"])["intensity"]

    assert band["score"] > 1
    assert band["axis"] == 2
    assert constant["score"] == 0
    assert gradient["score"] == pytest.approx(0, abs=1e-12)


def test_shallow_tilt_is_sampled_and_angle_resolution_is_explicit(controls):
    labels, cases, screen = controls
    fine = screen.slab(cases["shallow_slab"] == -1)
    coarse = Screen(labels, Parameters(min_support=30, slopes=(-1., -.5, 0., .5, 1.)))
    # One-voxel bins split a shallow slab across adjacent intervals. Require
    # the declared middle screening threshold, not perfect recovery.
    assert fine["score"] > .5
    assert fine["score"] > coarse.slab(cases["shallow_slab"] == -1)["score"]


def test_matching_region_labels_suppress_composition_boundary(controls):
    labels, cases, screen = controls
    coords = np.indices(labels.shape)
    split_labels = labels * np.where(coords[0] < labels.shape[0] // 2, 1, 2)

    unmodelled = screen.score(cases["regional_boundary"])["intensity"]
    modelled = Screen(split_labels, PARAMETERS).score(
        cases["regional_boundary"])["intensity"]

    # This is a documented failure mode when the supplied regions do not
    # describe a real composition boundary.
    assert unmodelled["score"] > 0.7
    assert modelled["score"] == pytest.approx(0, abs=1e-12)


def test_unavailable_populations_and_measured_zero_are_explicit():
    shape = (9, 9, 9)
    empty = Screen(np.zeros(shape, dtype=int), Parameters(min_support=3))
    empty_result = empty.score(np.ones(shape))
    assert empty_result["missing_labelled"] is None
    assert empty_result["missing_interior"] is None
    assert empty_result["slab"]["score"] is None
    assert empty_result["intensity"]["score"] is None

    labelled = Screen(np.ones(shape, dtype=int), Parameters(erosion=0, min_support=3))
    all_missing = labelled.score(np.full(shape, -1.0))
    zero = labelled.score(np.zeros(shape))
    assert all_missing["intensity"]["score"] is None
    assert zero["missing_interior"] == 0
    assert zero["intensity"]["score"] == 0


@pytest.mark.parametrize("invalid", (-2.0, np.nan, np.inf, -np.inf))
def test_invalid_source_values_are_rejected(invalid):
    labels = np.ones((7, 7, 7), dtype=int)
    values = np.zeros(labels.shape)
    values[3, 3, 3] = invalid
    with pytest.raises(ValueError, match="Unexpected source values"):
        Screen(labels, Parameters(erosion=0, min_support=3)).score(values)


def test_wrong_stride_is_caught_by_source_bytes_not_assumed_detector_behavior(tmp_path):
    labels, cases = synthetic_cases()
    expected = np.asarray(cases["tilted_slab_2"], dtype="<f4")
    wrong_stride = expected.ravel().reshape(labels.shape, order="F")
    assert not np.array_equal(expected, wrong_stride)

    source = tmp_path / "volume.raw"
    source.write_bytes(wrong_stride.astype("<f4").tobytes())
    expected_digest = hashlib.sha256(expected.tobytes()).hexdigest()
    with pytest.raises(ValueError, match="Source hash mismatch"):
        verify(source, expected_digest)
