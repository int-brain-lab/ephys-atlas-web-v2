"""Build the self-contained, non-authoritative Q14 distribution review lab."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any


FORMAT = "ibl-scalar-distribution-review-lab-v1"
POLICY_VERSION = "q14-agent-candidate-policy-v1"
DRAFT_FORMAT = "ibl-scalar-distribution-review-draft-v1"
MARKER = "__DISTRIBUTION_REVIEW_LAB_DATA__"


@dataclass(frozen=True)
class InputSpec:
    audit: Path
    selection: Path
    expected_sha256: str | None = None


DEFAULT_INPUTS = (
    InputSpec(
        Path("artifacts/distribution-audit/channels-2026_W32-source-audit.json"),
        Path("docs/data/CHANNELS_DISTRIBUTION_SELECTION.json"),
        "3d411601c1fed8f06d53649c2e7a438acb94a053dc966f0bb43520616af35f3a",
    ),
    InputSpec(
        Path("artifacts/distribution-audit/clusters/clusters-source.json"),
        Path("docs/data/CLUSTERS_DISTRIBUTION_SELECTION.json"),
        "fb475e95cf0991b3ffb599b405de0df362d275011d54393df9d18de458ae5bca",
    ),
    InputSpec(
        Path("artifacts/distribution-audit/brainwide-map-source.json"),
        Path("docs/data/BRAINWIDE_MAP_DISTRIBUTION_SELECTION.json"),
        "14079fc5c8bfc2d158bc86f0c17edad246263cbb61d6e29c4a8c301b385b36a5",
    ),
    InputSpec(
        Path("artifacts/distribution-audit/volumes-source.json"),
        Path("docs/data/VOLUME_2026_W26_DISTRIBUTION_SELECTION.json"),
        "12e306a726b7037e781f60d8e4d18effd23a194ff2e3b4d3adfb20bfe09dfa8d",
    ),
)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _scale_kinds(display: dict[str, Any]) -> list[str]:
    return [scale["kind"] for scale in display["scales"]]


def _domain_kinds(display: dict[str, Any]) -> list[str]:
    return [domain["kind"] for domain in display["distribution_domains"]]


def _copy_display(display: dict[str, Any]) -> dict[str, Any]:
    return json.loads(json.dumps(display))


def _add_scale(display: dict[str, Any], scale: dict[str, Any]) -> None:
    if scale["kind"] not in _scale_kinds(display):
        display["scales"].append(scale)


def _add_focused(display: dict[str, Any], feature: dict[str, Any]) -> bool:
    focused = feature["candidates"]["focused"]
    bounds = focused["bounds"]
    if not bounds["upper"] > bounds["lower"]:
        return False
    if "focused" not in _domain_kinds(display):
        display["distribution_domains"].append(
            {"kind": "focused", "bounds": [bounds["lower"], bounds["upper"]]}
        )
    return True


def propose_display(
    dataset_id: str, feature: dict[str, Any], baseline: dict[str, Any]
) -> tuple[dict[str, Any], list[str]]:
    """Apply the explicit advisory policy without producing an owner selection."""
    display = _copy_display(baseline)
    identifier = feature["id"]
    fraction = feature["diagnostics"]["full_linear_largest_bin_fraction"]
    counts = feature["value_counts"]
    reasons = ["Accepted baseline choices are preserved."]

    if dataset_id in {"brainwide_map", "ephys_atlas_volumes"}:
        reasons.append("Policy v1 retains Linear/Full for this dataset.")
        return display, reasons

    if dataset_id == "ephys_atlas_channels":
        if identifier == "peak_val.raw":
            reasons.append("D052's accepted exact scale, threshold, bounds, and defaults are retained.")
            return display, reasons
        excluded = identifier.startswith(("channel_labels.", "decay_n_peaks.", "spike_count."))
        if excluded:
            reasons.append("Discrete/count-like channel feature is excluded from added candidates.")
            return display, reasons
        if fraction >= 0.25 and _add_focused(display, feature):
            reasons.append(f"Focused is offered because Full/Linear's largest bin is {fraction:.1%}.")
            if fraction >= 0.50:
                display["preferred_distribution_domain"] = "focused"
                reasons.append("Focused is preferred at the policy's 50% collapse threshold.")
        if fraction >= 0.25 and counts["positive_count"] == counts["finite_count"]:
            _add_scale(display, {"kind": "log"})
            reasons.append("Log is offered because the complete finite population is positive.")
        mixed = counts["negative_count"] > 0 and counts["positive_count"] > 0
        thresholds = feature["candidates"]["full"]["symlog"]["threshold_candidates"]
        if fraction >= 0.25 and mixed and thresholds:
            threshold = thresholds[len(thresholds) // 2]["linear_threshold"]
            _add_scale(display, {"kind": "symlog", "linear_threshold": threshold})
            reasons.append("Signed log is offered for a mixed-sign collapsed population using the middle audited c candidate.")
        display["preferred_scale"] = "linear"
        return display, reasons

    if dataset_id == "ephys_atlas_clusters":
        excluded = identifier in {
            "amp_std_dB", "missed_spikes_est", "presence_ratio", "slidingRP_viol"
        }
        if not excluded and fraction >= 0.50 and _add_focused(display, feature):
            reasons.append(f"Focused is offered because Full/Linear's largest bin is {fraction:.1%}.")
            if fraction >= 0.80:
                display["preferred_distribution_domain"] = "focused"
                reasons.append("Focused is preferred at the policy's 80% cluster threshold.")
        elif excluded:
            reasons.append("Bounded/discrete cluster feature is excluded from Focused.")
        if identifier == "noise_cutoff":
            thresholds = feature["candidates"]["full"]["symlog"]["threshold_candidates"]
            if not thresholds:
                raise ValueError("noise_cutoff has no audited Signed-log threshold")
            threshold = thresholds[0]["linear_threshold"]
            _add_scale(display, {"kind": "symlog", "linear_threshold": threshold})
            display["preferred_scale"] = "symlog"
            reasons.append("Signed log is preferred using the lowest audited c candidate.")
        return display, reasons

    raise ValueError(f"unsupported review dataset: {dataset_id}")


def _validate_audit(audit: dict[str, Any]) -> None:
    if audit.get("audit_id") != "ephys-atlas-distribution-audit-v1":
        raise ValueError("input is not a distribution audit v1 report")
    if audit.get("read_only") is not True or audit.get("defaults_selected") is not False:
        raise ValueError("audit report is not read-only candidate evidence")
    if audit.get("representation") not in {"regional", "volume"}:
        raise ValueError("unsupported audit representation")


def _validate_selection(selection: dict[str, Any]) -> None:
    if selection.get("schema") != "ibl-scalar-distribution-selection-v1":
        raise ValueError("baseline is not a scalar distribution selection v1")
    if selection.get("scientific_owner_confirmation") is not True:
        raise ValueError("baseline must be an already accepted selection")


def build_report(inputs: tuple[InputSpec, ...] | list[InputSpec]) -> dict[str, Any]:
    datasets = []
    seen: set[str] = set()
    for spec in inputs:
        actual_hash = sha256_file(spec.audit)
        if spec.expected_sha256 and actual_hash != spec.expected_sha256:
            raise ValueError(f"audit SHA-256 mismatch: {spec.audit}")
        audit = json.loads(spec.audit.read_text())
        selection = json.loads(spec.selection.read_text())
        _validate_audit(audit)
        _validate_selection(selection)
        for field in ("dataset_id", "representation"):
            if audit[field] != selection[field]:
                raise ValueError(f"audit/baseline {field} mismatch")
        if audit["release_id"] != selection["source_release_id"]:
            raise ValueError("audit/baseline source release mismatch")
        dataset_id = audit["dataset_id"]
        if dataset_id in seen:
            raise ValueError(f"duplicate dataset: {dataset_id}")
        seen.add(dataset_id)
        audit_features = {feature["id"]: feature for feature in audit["features"]}
        baseline_features = {feature["id"]: feature["display"] for feature in selection["features"]}
        if len(audit_features) != len(audit["features"]) or len(baseline_features) != len(selection["features"]):
            raise ValueError("duplicate feature id")
        if audit_features.keys() != baseline_features.keys():
            raise ValueError("audit and accepted baseline feature catalogs differ")
        features = []
        for identifier in sorted(audit_features):
            feature = audit_features[identifier]
            proposal, rationale = propose_display(dataset_id, feature, baseline_features[identifier])
            features.append({
                "id": identifier,
                "audit": feature,
                "accepted_baseline": baseline_features[identifier],
                "agent_proposal": proposal,
                "rationale": rationale,
            })
        datasets.append({
            "dataset_id": dataset_id,
            "representation": audit["representation"],
            "source_release_id": audit["release_id"],
            "population": audit["population"],
            "observation_unit": audit["observation_unit"],
            "audit_sha256": actual_hash,
            "accepted_selection_id": selection["selection_id"],
            "accepted_selection_sha256": sha256_file(spec.selection),
            "features": features,
        })
    return {
        "format": FORMAT,
        "policy_version": POLICY_VERSION,
        "status": "local read-only review; no scientific approval or production effect",
        "datasets": datasets,
        "guardrails": [
            "Agent proposals are presentation recommendations for owner review, not scientific selections.",
            "This report does not edit selection files, build releases, publish data, or confirm ownership approval.",
            "Exports deliberately omit the production approval flag and require a later explicit approval workflow.",
        ],
    }


def load_initial_review(report: dict[str, Any], path: Path) -> list[dict[str, Any]]:
    """Resolve an ignored local draft into safe browser bootstrap entries."""
    draft = json.loads(path.read_text())
    if draft.get("format") != DRAFT_FORMAT or draft.get("policy_version") != POLICY_VERSION:
        raise ValueError("local review draft identity mismatch")
    features = {
        (dataset["dataset_id"], feature["id"]): feature
        for dataset in report["datasets"]
        for feature in dataset["features"]
    }
    resolved = []
    seen: set[tuple[str, str]] = set()
    for choice in draft.get("choices", []):
        identity = (choice.get("dataset_id"), choice.get("feature_id"))
        if identity in seen or identity not in features:
            raise ValueError("local review draft has an unknown or duplicate feature")
        seen.add(identity)
        feature = features[identity]
        disposition = choice.get("disposition")
        if disposition == "accept-proposal":
            display = feature["agent_proposal"]
        elif disposition == "retain-baseline":
            display = feature["accepted_baseline"]
        else:
            raise ValueError("local review draft has an unsupported disposition")
        resolved.append({
            "key": f"{identity[0]}\0{identity[1]}",
            "disposition": disposition,
            "display": display,
            "notes": choice.get("notes", ""),
        })
    return resolved


def render_report(report: dict[str, Any], template: str) -> bytes:
    if template.count(MARKER) != 1:
        raise ValueError("review template must contain exactly one data marker")
    lowered = template.lower()
    if any(token in lowered for token in (' src="http', " src='http", ' href="http', " href='http")):
        raise ValueError("review template contains an external resource")
    payload = json.dumps(report, sort_keys=True, separators=(",", ":")).replace("</", "<\\/")
    return template.replace(MARKER, payload).encode()


def write_report(report: dict[str, Any], template: Path, output: Path) -> Path:
    allowed = (Path.cwd() / "artifacts/distribution-review-lab").resolve()
    resolved = output.resolve()
    if resolved != allowed and allowed not in resolved.parents:
        raise ValueError("review output must stay under artifacts/distribution-review-lab")
    rendered = render_report(report, template.read_text())
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_name(f".{output.name}.tmp")
    temporary.write_bytes(rendered)
    os.replace(temporary, output)
    return output


def parser() -> argparse.ArgumentParser:
    command = argparse.ArgumentParser(description=__doc__)
    command.add_argument("--output", type=Path, default=Path("artifacts/distribution-review-lab/index.html"))
    command.add_argument("--template", type=Path, default=Path(__file__).with_name("template.html"))
    command.add_argument(
        "--draft",
        type=Path,
        default=Path("artifacts/distribution-review-lab/draft.json"),
        help="optional ignored local draft used to seed an unfinished review",
    )
    return command


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    report = build_report(DEFAULT_INPUTS)
    if args.draft.is_file():
        report["initial_review"] = load_initial_review(report, args.draft)
    output = write_report(report, args.template, args.output)
    print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
