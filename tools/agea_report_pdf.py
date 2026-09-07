"""Render the AGEA stripe-screening evidence as a review PDF.

The report visualizes existing outputs from :mod:`tools.agea_stripe_report`.
It neither recomputes detector results nor assigns scientific validity.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import textwrap

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.backends.backend_pdf import PdfPages
from matplotlib.colors import ListedColormap
import numpy as np
import pandas as pd

from tools.agea_benchmark import SHAPE, sha256, verify


MISSING_CMAP = ListedColormap(["#e8e8e8", "#542788"])
AXES = ("ML", "DV", "AP")
SPACING_UM = 200


def _load_json(path: Path):
    with path.open() as stream:
        return json.load(stream)


def _new_page(title: str):
    fig = plt.figure(figsize=(12, 7.5))
    fig.subplots_adjust(left=.065, right=.95, bottom=.14, top=.83, wspace=.35, hspace=.48)
    fig.suptitle(title, x=.04, y=.975, ha="left", fontsize=19, fontweight="bold")
    return fig


def _footer(fig, page: int):
    fig.text(.04, .018, "AGEA exploratory screening • source spacing 200 µm • no production QC choice",
             fontsize=7.5, color="#555555")
    fig.text(.96, .018, str(page), ha="right", fontsize=8, color="#555555")


def _text_page(pdf, page, title, lines, *, small=False):
    fig = _new_page(title)
    ax = fig.add_subplot(111)
    ax.axis("off")
    y = .9
    for heading, body in lines:
        ax.text(.02, y, heading, transform=ax.transAxes, fontsize=13, fontweight="bold",
                va="top", color="#243b53")
        wrapped = textwrap.fill(body, 115 if small else 100)
        ax.text(.02, y - .055, wrapped, transform=ax.transAxes,
                fontsize=9.2 if small else 10.5, va="top", linespacing=1.35)
        y -= .055 + (.041 if small else .048) * (wrapped.count("\n") + 1) + .045
    _footer(fig, page)
    pdf.savefig(fig)
    plt.close(fig)


def _missing_image(ax, mask, title, xlabel, ylabel, *, overlay=None):
    ax.imshow(mask, origin="lower", interpolation="nearest", cmap=MISSING_CMAP,
              vmin=0, vmax=1, aspect="equal")
    if overlay is not None and np.any(overlay) and np.any(~overlay):
        ax.contour(overlay, levels=[.5], colors=["#e66101"], linewidths=1.4)
    ax.set_title(title, fontsize=10)
    ax.set_xlabel(f"{xlabel} index ({SPACING_UM} µm steps)", fontsize=8)
    ax.set_ylabel(f"{ylabel} index ({SPACING_UM} µm steps)", fontsize=8)
    ax.tick_params(labelsize=7)


def _experiment_lookup(source: Path):
    rows = pd.read_parquet(source / "gene-expression.pqt")
    ids = rows["id"].astype(str).tolist()
    return rows, {experiment_id: index for index, experiment_id in enumerate(ids)}


def _case_plane(values, score):
    slab = score["slab"]
    normal = np.asarray(slab.get("normal") or [0, 0, 1], dtype=float)
    # Cut along the direction least aligned to the fitted normal. This crosses
    # the slab and displays it as a strip instead of selecting a plane within it.
    axis = int(np.argmin(np.abs(normal)))
    index = values.shape[axis] // 2
    plane = np.take(values == -1, index, axis=axis)
    remaining = [a for a in range(3) if a != axis]
    return plane.T, axis, index, AXES[remaining[0]], AXES[remaining[1]]


def _intensity_image(fig, ax, values, score, title):
    intensity = score["intensity"]
    axis = int(intensity["axis"])
    index = int(intensity["index"])
    plane = np.take(values, index, axis=axis).T
    measured = plane[plane >= 0]
    vmax = float(np.quantile(measured, .95)) if measured.size else 1.0
    vmax = max(vmax, np.finfo(float).eps)
    cmap = matplotlib.colormaps["viridis"].copy()
    cmap.set_bad("#bdbdbd")
    image = ax.imshow(np.ma.masked_where(plane == -1, plane), origin="lower",
                      interpolation="nearest", cmap=cmap, vmin=0, vmax=vmax,
                      aspect="equal")
    remaining = [a for a in range(3) if a != axis]
    ax.set_title(f"{title}\nenergy at {AXES[axis]} {index}; grey = −1", fontsize=8)
    ax.set_xlabel(f"{AXES[remaining[0]]} index", fontsize=7)
    ax.set_ylabel(f"{AXES[remaining[1]]} index", fontsize=7)
    ax.tick_params(labelsize=6)
    colorbar = fig.colorbar(image, ax=ax, shrink=.55, pad=.02)
    colorbar.set_label("Expression energy (0–plane P95)", fontsize=6)
    colorbar.ax.tick_params(labelsize=5)
    inset = ax.inset_axes([.54, .62, .42, .3], facecolor=(1, 1, 1, .88))
    profile = intensity["profiles"][axis]
    xs = np.arange(len(profile))
    ys = np.array([np.nan if value is None else value for value in profile])
    inset.plot(xs, ys, color="#d95f02", linewidth=1)
    inset.axvline(index, color="#222222", linewidth=.8, linestyle="--")
    inset.set_title("centered log1p profile", fontsize=5)
    inset.tick_params(labelsize=4, length=2)


def _render(source: Path, output: Path):
    scores = _load_json(output / "scores.json")
    summary = _load_json(output / "summary.json")
    for name, entry in summary["sources"].items():
        verify(source / name, entry["sha256"])
    direct = _load_json(output / "ptpru-source.json")
    sections = _load_json(output / "ptpru-sections.json")
    regions = _load_json(output / "regions.json")
    frequency = np.load(output / "missing-frequency.npy", allow_pickle=False)
    if frequency.shape != SHAPE[1:]:
        raise ValueError(f"Unexpected missing-frequency shape: {frequency.shape}")
    rows, by_id = _experiment_lookup(source)
    volumes = np.memmap(source / "gene-expression.bin", dtype="<f2", mode="r", shape=SHAPE)
    score_by_id = {row["experiment_id"]: row for row in scores}
    ptpru = np.asarray(volumes[by_id["858"]])
    missing = ptpru == -1

    report_path = output / "report.pdf"
    metadata = {"Title": "AGEA missing-slab and intensity-band screening",
                "Author": "IBL Ephys Atlas Web v2", "CreationDate": None,
                "ModDate": None, "Subject": summary["status"]}
    with PdfPages(report_path, metadata=metadata) as pdf:
        subset = summary.get("direct_source_subset")
        direct_statement = (
            f" A declared subset of {subset['checked']} Allen archives all matched their IBL rows."
            if subset else ""
        )
        _text_page(pdf, 1, "AGEA screening: what is known, and what is not", [
            ("Question", "Do original Allen AGEA grids contain spatially coherent missing slabs or intensity banding that colleagues recognize, and how should these observations inform later review?"),
            ("Confirmed", f"The original catalog contains {summary['experiments']:,} experiments / {summary['gene_symbols']:,} symbols. Ptpru 858 is byte-traceable to an Allen archive and its entire float32 grid equals the IBL row after float16 conversion.{direct_statement}"),
            ("Screening evidence", "Missingness, connected gaps, oblique slab contrast, and region-centered intensity changes are separate continuous diagnostics. Synthetic controls test intended behavior before catalog interpretation."),
            ("Unresolved", "Automated flags are not defect labels or prevalence. Section omission is a hypothesis lead, transform interpretation remains source-specific, and no scientist adjudication, repair, production mask, affine, or source choice is made here."),
        ])

        fig = _new_page("Ptpru 858 — consecutive coronal missing masks")
        axes = fig.subplots(1, 4)
        for ax, ap in zip(axes, (59, 60, 61, 62)):
            _missing_image(ax, missing[:, :, ap].T, f"AP {ap}", "ML", "DV")
        fig.legend(handles=[plt.Line2D([], [], marker="s", color="none", markerfacecolor="#542788", label="Missing (energy = −1)"),
                            plt.Line2D([], [], marker="s", color="none", markerfacecolor="#e8e8e8", label="Measured (energy ≥ 0)")],
                   loc="lower center", bbox_to_anchor=(.5, .075), ncol=2,
                   frameon=False, fontsize=9)
        fig.text(.5, .11, "Raw source-grid masks; all voxels shown. No labels, interpolation, cursor, or anatomy overlay.", ha="center", fontsize=9)
        _footer(fig, 2); pdf.savefig(fig); plt.close(fig)

        fig = _new_page("Ptpru 858 — three-plane source reproduction")
        axes = fig.subplots(1, 3)
        _missing_image(axes[0], missing[:, :, 61].T, "Coronal • AP 61", "ML", "DV")
        _missing_image(axes[1], missing[29, :, :], "Sagittal • ML 29", "AP", "DV")
        _missing_image(axes[2], missing[:, 20, :].T, "Horizontal • DV 20", "ML", "AP")
        comparison = direct["comparison"]
        offsets = ", ".join(str(v["raw_byte_offset"]) for v in comparison["selected_voxels"])
        fig.text(.5, .08, f"Full float16 equality: {comparison['float16_full_volume_equal']} • mismatches: {comparison['float16_mismatch_count']} / {comparison['voxel_count']:,} • independent raw byte offsets: {offsets}", ha="center", fontsize=8.5)
        fig.text(.5, .055, f"Header DimSize {direct['metaimage']['fields']['DimSize']} → NumPy {tuple(direct['metaimage']['numpy_shape'])}; raw values are Allen expression energy.", ha="center", fontsize=8.5)
        _footer(fig, 3); pdf.savefig(fig); plt.close(fig)

        fig = _new_page("Ptpru 858 — absent-section projection hypothesis")
        ax1, ax2, image_ax1, image_ax2 = fig.subplots(2, 2).ravel()
        sec = sections["sections"]
        present = [s for s in sec if s["present"] and s["interior"]["fraction"] is not None]
        absent = [s for s in sec if not s["present"] and s["interior"]["fraction"] is not None]
        ax1.plot([s["number"] for s in present], [s["interior"]["fraction"] for s in present], ".-", color="#2166ac", label="Present image record")
        ax1.scatter([s["number"] for s in absent], [s["interior"]["fraction"] for s in absent], marker="x", s=55, color="#e66101", label="Absent from modal sequence")
        ax1.set(xlabel="Section number", ylabel="Missing fraction in eroded labelled support")
        ax1.legend(frameon=False, fontsize=8); ax1.grid(alpha=.2)
        fields = direct["metaimage"]["fields"]
        spacing = np.fromstring(fields["ElementSpacing"], sep=" ")
        offset = np.fromstring(fields["Offset"], sep=" ")
        matrix = np.fromstring(fields["TransformMatrix"], sep=" ").reshape(3, 3)
        coords = np.indices(ptpru.shape, dtype=float)[::-1].reshape(3, -1)
        reference = matrix @ (coords * spacing[:, None]) + offset[:, None]
        trv = np.asarray(sections["trv"])
        z = (trv[:9].reshape(3, 3) @ reference + trv[9:, None])[2].reshape(ptpru.shape)
        band42 = abs(z - 42 * sections["section_thickness_um"]) <= sections["band_half_width_um"]
        _missing_image(ax2, missing[:, :, 61].T, "AP 61; proposed section 42 band", "ML", "DV", overlay=band42[:, :, 61].T)
        receipt_path = output / "downloads/allen-858-adjacent-image-receipt.json"
        if receipt_path.exists():
            receipt = _load_json(receipt_path)
            for ax, item in zip((image_ax1, image_ax2), receipt["images"]):
                ax.imshow(plt.imread(output / "downloads" / item["file"]))
                ax.set_title(f"Available section {item['section_number']} • image {item['image_id']}", fontsize=9)
                ax.axis("off")
        else:
            for ax in (image_ax1, image_ax2):
                ax.text(.5, .5, "Adjacent source image not acquired", ha="center", va="center")
                ax.axis("off")
        absent_hits = sum(s["interior"]["missing"] for s in absent)
        absent_support = sum(s["interior"]["support"] for s in absent)
        absent_rates = ", ".join(f"{s['number']}: {100*s['interior']['fraction']:.1f}%" for s in absent)
        fig.text(.5, .069, f"Absent bands — {absent_rates}; pooled {absent_hits:,}/{absent_support:,} ({100*absent_hits/absent_support:.1f}%). Round-trip ≤ {sections['roundtrip_max_error_um']:.3f} µm. Sections 34/50 show substantial tissue (minor fragments at 50), but cannot explain absent 42.", ha="center", fontsize=7.7)
        fig.text(.5, .049, "Orange is the actual projected section-42 band (±half modal interval). Association supports an acquisition-gap hypothesis; it does not prove damage, causal gridding mechanism, or production registration.", ha="center", fontsize=7.7)
        _footer(fig, 4); pdf.savefig(fig); plt.close(fig)

        fig = _new_page("Diagnostics and synthetic controls")
        fig.set_layout_engine(None)
        fig.subplots_adjust(left=.16, right=.97, bottom=.24, top=.85, wspace=.58)
        ax1, ax2 = fig.subplots(1, 2)
        controls = summary["controls"]
        names = list(controls)
        slab = [controls[n]["slab"]["score"] or 0 for n in names]
        intensity = [controls[n]["intensity"]["score"] or 0 for n in names]
        y = np.arange(len(names))
        ax1.barh(y, slab, color="#542788"); ax1.set_yticks(y, [n.replace("_", " ") for n in names], fontsize=7); ax1.invert_yaxis(); ax1.set_xlabel("Oblique slab contrast score")
        ax2.barh(y, intensity, color="#b35806"); ax2.set_yticks(y, [n.replace("_", " ") for n in names], fontsize=7); ax2.invert_yaxis(); ax2.set_xlabel("Region-centered intensity change")
        fig.text(.5, .13, f"Slabs: missing fraction minus the larger shoulder fraction; {summary['directions']} directions, widths 1–3 voxels, ≥100 voxels per interval (30 in controls).", ha="center", fontsize=8.5)
        fig.text(.5, .10, "Intensity: half the largest second difference of slice means after region-centering log1p values and clipping residuals to ±3.", ha="center", fontsize=8.5)
        fig.text(.5, .06, "Angle sampling was refined after inspecting Ptpru. Controls test the implementation; they are not held-out scientific validation.", ha="center", fontsize=8.5)
        _footer(fig, 5); pdf.savefig(fig); plt.close(fig)

        fig = _new_page("Catalog screening distributions and threshold sensitivity")
        fig.set_layout_engine(None)
        fig.subplots_adjust(left=.10, right=.97, bottom=.22, top=.85, wspace=.30)
        ax1, ax2 = fig.subplots(1, 2)
        slab_scores = np.array([r["slab"]["score"] for r in scores if r["slab"]["score"] is not None])
        intensity_scores = np.array([r["intensity"]["score"] for r in scores if r["intensity"]["score"] is not None])
        ax1.hist(slab_scores, bins=40, color="#542788", alpha=.85); ax1.set(xlabel="Slab score", ylabel="Experiments")
        ax2.hist(intensity_scores, bins=40, color="#b35806", alpha=.85); ax2.set(xlabel="Intensity score", ylabel="Experiments")
        threshold = summary["slab_threshold_counts"]
        fig.text(.5, .077, "Provisional slab flags: " + " • ".join(f"score ≥ {k}: {v:,}" for k, v in threshold.items()), ha="center", fontsize=9)
        fig.text(.5, .052, "Counts show threshold sensitivity, not defect prevalence; no threshold was scientifically accepted and no catalog cases were manually confirmed.", ha="center", fontsize=8.3)
        _footer(fig, 6); pdf.savefig(fig); plt.close(fig)

        fig = _new_page("Where missing values occur across the catalog")
        fig.set_layout_engine(None)
        fig.subplots_adjust(left=.10, right=.96, bottom=.19, top=.85, wspace=.75, hspace=.6)
        axes = fig.subplots(2, 2).ravel()
        fraction = frequency.astype(float) / summary["experiments"]
        planes = [(fraction[:, :, 33].T, "Coronal AP 33", "ML", "DV"),
                  (fraction[29, :, :], "Sagittal ML 29", "AP", "DV"),
                  (fraction[:, 20, :].T, "Horizontal DV 20", "ML", "AP")]
        image = None
        for ax, (plane, title, xlabel, ylabel) in zip(axes[:3], planes):
            image = ax.imshow(plane, origin="lower", interpolation="nearest", vmin=0, vmax=1, cmap="magma", aspect="equal")
            ax.set_title(title, fontsize=9); ax.set_xlabel(f"{xlabel} index", fontsize=8); ax.set_ylabel(f"{ylabel} index", fontsize=8)
        colorbar_axis = fig.add_axes([.475, .45, .015, .30])
        fig.colorbar(image, cax=colorbar_axis, label="Fraction of experiments missing")
        top_regions = sorted(regions, key=lambda r: r["experiment_voxel_support"], reverse=True)[:6]
        axes[3].barh(range(len(top_regions)), [r["missing_fraction"] for r in top_regions], color="#8073ac")
        region_labels = [
            (f"{r.get('acronym') or r.get('name')} ({r.get('region_id')}); n={r['spatial_support']:,}"
             if r.get("acronym") or r.get("name") else str(r["supplied_label_index"]))
            for r in top_regions
        ]
        axes[3].set_yticks(range(len(top_regions)), region_labels, fontsize=7); axes[3].invert_yaxis()
        axes[3].set(xlabel="Missing fraction", title="Largest region supports")
        fig.text(.5, .075, "Region labels show signed ID and spatial voxel count n; each fraction has denominator n × 4,345 experiments. Void = supplied zero label.", ha="center", fontsize=8.3)
        fig.text(.5, .05, "These coarse-grid summaries include boundary mismatch and coherent gaps. They do not measure stripe frequency alone.", ha="center", fontsize=8.3)
        _footer(fig, 7); pdf.savefig(fig); plt.close(fig)

        selected = summary["selected_ids"]
        random_ids = set(summary["random_ids"])
        ranked = sorted(scores, key=lambda r: -(r["slab"]["score"] or 0))
        top_ids = {r["experiment_id"] for r in ranked[:3]}
        bottom_ids = {r["experiment_id"] for r in ranked[-2:]}
        intensity_ids = {r["experiment_id"] for r in sorted(scores, key=lambda r: -(r["intensity"]["score"] or 0))[:2]}
        for page, ids in ((8, selected[:6]), (9, selected[6:])):
            fig = _new_page(f"Declared review sample — cases {page - 7} of 2")
            axes = np.atleast_1d(fig.subplots(2, 3)).ravel()
            for ax, experiment_id in zip(axes, ids):
                score = score_by_id[experiment_id]
                categories = (["Ptpru"] if experiment_id == "858" else []) + (["top slab"] if experiment_id in top_ids else []) + (["bottom slab"] if experiment_id in bottom_ids else []) + (["top intensity"] if experiment_id in intensity_ids else []) + (["random"] if experiment_id in random_ids else [])
                gene = str(rows.iloc[by_id[experiment_id]]["gene"])
                values = np.asarray(volumes[by_id[experiment_id]])
                title = f"{gene} {experiment_id} • {', '.join(categories)}"
                if experiment_id in intensity_ids:
                    _intensity_image(fig, ax, values, score, title)
                else:
                    plane, axis, index, xaxis, yaxis = _case_plane(values, score)
                    _missing_image(ax, plane, f"{title}\n{AXES[axis]} {index}; slab {score['slab']['score']:.3f}", xaxis, yaxis)
            for ax in axes[len(ids):]: ax.axis("off")
            case_caption = textwrap.fill(
                summary["selection_rule"] + ". Slab views cut across the fitted plane "
                "at the central least-normal-axis index; intensity views include the "
                "winning-axis profile. Examples await review.", 145)
            fig.text(.5, .058, case_caption, ha="center", va="center", fontsize=7.2)
            _footer(fig, page); pdf.savefig(fig); plt.close(fig)

        fig = _new_page("Repeated experiments and mask-erosion sensitivity")
        fig.set_layout_engine(None)
        fig.subplots_adjust(left=.10, right=.97, bottom=.25, top=.85, wspace=.30)
        ax1, ax2 = fig.subplots(1, 2)
        groups = summary["repeated_experiments"]
        for group in groups:
            ax1.plot([r["experiment_id"] for r in group], [r["slab_score"] for r in group], "o-", label=group[0]["gene"])
        ax1.set(xlabel="Experiment ID", ylabel="Slab score", title="Repeated-symbol contrasts"); ax1.tick_params(axis="x", rotation=55, labelsize=7); ax1.legend(frameon=False, fontsize=7)
        erosion = summary["sensitivity"]
        for experiment_id in selected:
            values = [erosion[str(level)][experiment_id]["slab"]["score"] for level in (0, 1, 2)]
            ax2.plot((0, 1, 2), values, ".-", alpha=.7, label=experiment_id)
        ax2.set(xticks=(0, 1, 2), xlabel="Binary erosion iterations", ylabel="Slab score", title="Selected-case sensitivity"); ax2.legend(ncol=2, fontsize=6, frameon=False)
        fig.text(.5, .055, "Repeated gene symbols are distinct experiments. Erosion changes diagnostic support and does not define an accepted anatomical validity mask.", ha="center", fontsize=8.3)
        _footer(fig, 10); pdf.savefig(fig); plt.close(fig)

        _text_page(pdf, 11, "Limitations and questions for colleagues", [
            ("Source and registration", "Is the Ptpru moving missing band expected from acquisition coverage? Is header→trv→section-thickness the correct mapping here, including direction, units, section origin, and numbering convention?"),
            ("Missing sections", f"Sections absent from the modal sequence are {sections['absent_numbers']}. Which image or acquisition records should be inspected before relating these omissions to gridded missing values?"),
            ("Curtaining", "Does the missing slab share a cause with the intensity curtaining addressed by the pinned IBL processing, or are they distinct phenomena? Which repeated experiments are useful controls?"),
            ("Scientific handling", "Should review start from original or processed values? How should measured zero, −1, supplied zero labels, boundary mismatch, and possible imputation remain distinguishable?"),
            ("Evidence gaps", "A bounded archive subset has full float16 comparison, but the locked environment has no independent established MetaImage reader: only selected raw offsets are independently decoded with struct. Section projections were evaluated only for Ptpru. Examples are algorithmically sampled, not adjudicated."),
        ], small=True)

        references = summary["references"]
        env = summary["environment"]
        subset_provenance = (
            f" Direct-source subset: {subset['matches']}/{subset['checked']} matched; IDs "
            f"{', '.join(subset['ids'])}; selection: {subset['selection_rule']}; details in "
            f"{subset['evidence_file']}."
            if subset else ""
        )
        fig = _new_page("References, provenance, and reproduction")
        for i, ref in enumerate(references):
            fig.text(.06, .84 - .05 * i, f"[{i + 1}] {ref['title']}", fontsize=11,
                     color="#2166ac", url=ref["url"])
        fig.text(.06, .57, "Reference titles are clickable. Full URLs and source hashes accompany the JSON evidence.", fontsize=9)
        fig.text(.06, .49, "Provenance", fontsize=13, fontweight="bold")
        fig.text(.06, .45, f"Base commit: {env['commit']} (diagnostic source hashes identify working-tree additions).", fontsize=9)
        fig.text(.06, .415, f"Python {env['python']}; NumPy {env['numpy']}; generated {env['generated_utc']}.", fontsize=9)
        fig.text(.06, .38, textwrap.fill(subset_provenance.strip(), 130), fontsize=9, va="top")
        fig.text(.06, .26, "Reproduction", fontsize=13, fontweight="bold")
        fig.text(.06, .22, "Use docs/data/AGEA_STRIPE_REPORT.md for pinned inputs and complete commands.", fontsize=10)
        fig.text(.06, .18, "Run tools.agea_stripe_report, then --verify-samples, then tools.agea_report_pdf", fontsize=10)
        fig.text(.06, .14, "with the same --source and --output, through uv run --project builder --extra test --locked python -m.", fontsize=9)
        fig.text(.06, .095, "The report is reproducible review evidence. Original values, scientific validity and registration remain unchanged.", fontsize=9)
        _footer(fig, 12); pdf.savefig(fig); plt.close(fig)
    inputs = ["scores.json", "summary.json", "ptpru-source.json", "ptpru-sections.json",
              "regions.json", "missing-frequency.npy"]
    receipt = output / "downloads/allen-858-adjacent-image-receipt.json"
    if receipt.exists():
        inputs.append("downloads/allen-858-adjacent-image-receipt.json")
        for entry in _load_json(receipt)["images"]:
            verify(output / "downloads" / entry["file"], entry["sha256"])
            inputs.append("downloads/" + entry["file"])
    manifest = dict(pdf_sha256=sha256(report_path), renderer_sha256=sha256(Path(__file__)),
                    matplotlib=matplotlib.__version__,
                    inputs={name: sha256(output / name) for name in inputs})
    (output / "render-evidence.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return report_path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True, help="Original AGEA source directory")
    parser.add_argument("--output", type=Path, required=True, help="Existing screening-output directory")
    args = parser.parse_args()
    path = _render(args.source, args.output)
    print(path)


if __name__ == "__main__":
    main()
