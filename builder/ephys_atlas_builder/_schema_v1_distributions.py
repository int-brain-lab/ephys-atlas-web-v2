"""Schema-v1 distributions semantic checks; no alternate release contract."""

from __future__ import annotations
import math
from typing import Any

from ._schema_v1_common import _fail, _increasing, _unique


def _summary_semantics(document: dict[str, Any]) -> None:
    total = document["total_voxel_count"]
    valid = document["valid_voxel_count"]
    if total != math.prod(document["grid_shape"]):
        _fail("volume summary total does not match the grid shape")
    if total != valid + document["outside_voxel_count"] + document["missing_voxel_count"]:
        _fail("volume summary counts are not mutually exhaustive")
    stats = document["valid_statistics"]
    if valid == 0 and any(value is not None for value in stats.values()):
        _fail("zero-valid-voxel summary statistics must all be null")
    if valid > 0 and any(value is None for value in stats.values()):
        _fail("nonempty valid-voxel summary statistics cannot be null")
    if valid > 0 and any(not math.isfinite(value) for value in stats.values()):
        _fail("nonempty valid-voxel summary statistics must be finite")
    distribution = document.get("distribution")
    if valid == 0 and distribution is not None:
        _fail("zero-valid-voxel summary cannot contain a distribution")
    if valid > 0 and distribution is None:
        _fail("nonempty valid-voxel summary requires a distribution")
    if distribution:
        _distribution_semantics(
            distribution["binnings"],
            valid,
            "volume",
            minimum=stats["min"],
            maximum=stats["max"],
        )
    regional_distributions = document.get("regional_distributions")
    if valid == 0 and regional_distributions is not None:
        _fail("zero-valid-voxel summary cannot contain regional distributions")
    if regional_distributions:
        _volume_regional_distribution_semantics(
            regional_distributions,
            distribution["binnings"],
            valid,
        )


def _volume_regional_distribution_semantics(
    companions: list[dict[str, Any]],
    global_binnings: list[dict[str, Any]],
    valid_count: int,
) -> None:
    _unique(
        [companion["parcellation_id"] for companion in companions],
        "volume regional-distribution parcellation id",
    )
    columns_by_id = {
        binning["id"]: len(binning["edges"]) + 1 for binning in global_binnings
    }
    expected_ids = set(columns_by_id)
    for companion in companions:
        if (
            companion["assigned_valid_voxel_count"]
            + companion["unassigned_valid_voxel_count"]
            != valid_count
        ):
            _fail("volume regional-distribution counts do not conserve valid voxels")
        binnings = companion["binnings"]
        ids = [binning["binning_id"] for binning in binnings]
        _unique(ids, "volume regional-distribution binning id")
        if set(ids) != expected_ids:
            _fail("volume regional-distribution binnings must exactly match global binnings")
        for binning in binnings:
            regional = binning["regional_counts"]
            if regional["dtype"] != "uint32":
                _fail("volume regional-distribution count matrix must use uint32")
            shape = regional["shape"]
            if len(shape) != 2 or shape[1] != columns_by_id[binning["binning_id"]]:
                _fail("volume regional-distribution count matrix has invalid columns")


def _distribution_semantics(
    binnings: list[dict[str, Any]],
    denominator: int,
    description: str,
    *,
    minimum: float | None,
    maximum: float | None,
    regional_rows: int | None = None,
) -> None:
    ids = [binning["id"] for binning in binnings]
    _unique(ids, f"{description} distribution binning id")
    scales: dict[str, dict[str, Any]] = {}
    domains: dict[str, dict[str, Any]] = {}
    domain_endpoints: dict[str, tuple[float, float]] = {}
    combinations: set[tuple[str, str]] = set()
    for binning in binnings:
        scale = binning["scale"]
        domain = binning["domain"]
        scale_kind = scale["kind"]
        domain_kind = domain["kind"]
        if binning["id"] != f"{scale_kind}-{domain_kind}":
            _fail(f"{description} distribution binning id is not canonical")
        if scale_kind in scales and scale != scales[scale_kind]:
            _fail(f"{description} {scale_kind} scale specification is inconsistent")
        if domain_kind in domains and domain != domains[domain_kind]:
            _fail(f"{description} {domain_kind} domain specification is inconsistent")
        scales[scale_kind] = scale
        domains[domain_kind] = domain
        if (scale_kind, domain_kind) in combinations:
            _fail(f"duplicate {description} scale/domain binning")
        combinations.add((scale_kind, domain_kind))

        edges = binning["edges"]
        if scale_kind == "symlog" and not math.isfinite(scale["linear_threshold"]):
            _fail(f"{description} Signed-log threshold must be finite")
        _increasing(edges, f"{description} {binning['id']} distribution edges")
        endpoints = (edges[0], edges[-1])
        if domain_kind in domain_endpoints and endpoints != domain_endpoints[domain_kind]:
            _fail(f"{description} distribution raw domain endpoints differ across scales")
        domain_endpoints[domain_kind] = endpoints
        if scale_kind == "log":
            if any(edge <= 0 for edge in edges):
                _fail(f"{description} Log distribution edges must be positive")
            if minimum is not None and minimum <= 0:
                _fail(f"{description} Log distribution requires a strictly-positive population")
        if domain_kind == "focused":
            bounds = domain["bounds"]
            if not bounds[0] < bounds[1]:
                _fail(f"{description} Focused distribution bounds must be increasing")
            if edges[0] != bounds[0] or edges[-1] != bounds[1]:
                _fail(f"{description} Focused distribution edges must equal its raw-value bounds")
        elif binning["global_underflow_count"] or binning["global_overflow_count"]:
            _fail(f"{description} Full distribution tails must be zero")
        if len(binning["global_counts"]) != len(edges) - 1:
            _fail(f"{description} distribution counts length does not match edges")
        if (
            binning["global_underflow_count"]
            + sum(binning["global_counts"])
            + binning["global_overflow_count"]
            != denominator
        ):
            _fail(f"{description} distribution counts and tails do not conserve the population")
        if regional_rows is not None:
            regional = binning["regional_counts"]
            if regional["dtype"] != "uint32":
                _fail("regional distribution count matrix must use uint32")
            expected_shape = [regional_rows, len(edges) + 1]
            if regional["shape"] != expected_shape:
                _fail("regional distribution count matrix must use underflow-bins-overflow columns")
        elif "regional_counts" in binning or "regional_count_layout" in binning:
            _fail("volume distributions must remain global-only")

    if "linear" not in scales or "full" not in domains or ("linear", "full") not in combinations:
        _fail(f"{description} distribution requires Linear/Full")
    expected = {(scale, domain) for scale in scales for domain in domains}
    if combinations != expected:
        _fail(f"{description} distribution binnings must form a rectangular scale/domain cross-product")
    if "focused" in domain_endpoints:
        full_lower, full_upper = domain_endpoints["full"]
        focused_lower, focused_upper = domain_endpoints["focused"]
        if focused_lower < full_lower or focused_upper > full_upper:
            _fail(f"{description} Focused distribution must lie inside the Full domain")
    if minimum is not None:
        full_lower, full_upper = domain_endpoints["full"]
        if full_lower > minimum:
            _fail(f"{description} Full distribution does not enclose the declared minimum")
        if maximum is None or full_upper < maximum:
            _fail(f"{description} Full distribution does not enclose the declared maximum")


def _display_semantics(document: dict[str, Any]) -> None:
    representations = set(document["representations"])
    display = document["display"]
    if set(display) != representations:
        _fail("feature display keys must exactly match scalar representations")
    for representation, presentation in display.items():
        scales = presentation["scales"]
        domains = presentation["distribution_domains"]
        scale_kinds = [spec["kind"] for spec in scales]
        domain_kinds = [spec["kind"] for spec in domains]
        if len(scale_kinds) != len(set(scale_kinds)):
            _fail(f"duplicate {representation} display scale")
        if len(domain_kinds) != len(set(domain_kinds)):
            _fail(f"duplicate {representation} display distribution domain")
        if not scale_kinds or scale_kinds[0] != "linear":
            _fail(f"{representation} display must declare Linear first")
        if not domain_kinds or domain_kinds[0] != "full":
            _fail(f"{representation} display must declare Full first")
        if presentation["preferred_scale"] not in scale_kinds:
            _fail(f"preferred {representation} display scale is unavailable")
        if presentation["preferred_distribution_domain"] not in domain_kinds:
            _fail(f"preferred {representation} distribution domain is unavailable")
        center = presentation.get("diverging_center")
        if center is not None and not math.isfinite(center):
            _fail(f"{representation} diverging center must be finite")
        if presentation.get("colormap") == "coolwarm" and center is None:
            _fail(f"preferred diverging {representation} palette requires a center")
        for scale in scales:
            if scale["kind"] == "symlog" and not math.isfinite(scale["linear_threshold"]):
                _fail(f"{representation} Signed-log threshold must be finite")
        value_range = presentation.get("range")
        if value_range is not None and (
            not all(math.isfinite(value) for value in value_range)
            or not value_range[0] < value_range[1]
        ):
            _fail(f"{representation} display range must be finite and increasing")
        if value_range is not None and "log" in scale_kinds and value_range[0] <= 0:
            _fail(f"{representation} display range shared with Log must be positive")
        focused = [spec for spec in domains if spec["kind"] == "focused"]
        if focused and (
            not all(math.isfinite(value) for value in focused[0]["bounds"])
            or not focused[0]["bounds"][0] < focused[0]["bounds"][1]
        ):
            _fail(f"{representation} Focused bounds must be finite and increasing")


def _statistics_semantics(document: dict[str, Any]) -> None:
    summary = document["regional_summary"]
    if len(summary["values"]["shape"]) != 2 or summary["values"]["shape"][1] != len(summary["fields"]):
        _fail("regional summary shape does not match fields")
    count = document["global"]["count"]
    global_summary = document["global"]
    descriptive_fields = ("min", "max", "mean", "std", "median")
    reported_statistics = [
        value
        for field, value in global_summary.items()
        if field not in {"count", "missing_count"}
    ]
    if count == 0 and any(value is not None for value in reported_statistics):
        _fail("empty regional population descriptive statistics must be null")
    if count > 0 and any(global_summary[field] is None for field in descriptive_fields):
        _fail("nonempty regional population descriptive statistics cannot be null")
    if count > 0 and any(
        value is not None and not math.isfinite(value)
        for value in reported_statistics
    ):
        _fail("nonempty regional population descriptive statistics must be finite")
    distribution = document.get("distribution")
    if count == 0 and distribution is not None:
        _fail("empty regional population must omit its distribution")
    if count > 0 and distribution is None:
        _fail("nonempty regional population requires a distribution")
    if distribution:
        _distribution_semantics(
            distribution["binnings"],
            count,
            "regional",
            minimum=document["global"]["min"],
            maximum=document["global"]["max"],
            regional_rows=summary["values"]["shape"][0],
        )
