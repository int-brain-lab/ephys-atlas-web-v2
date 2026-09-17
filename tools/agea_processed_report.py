"""Render a bounded original-versus-processed AGEA review PDF."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import textwrap
from pathlib import Path

import numpy as np
import pandas as pd

from tools.agea_benchmark import SHAPE
from tools.agea_processed_audit import DEFAULT_SAMPLES, PROCESSED_NAME


def _plane(values: np.ndarray, axis: int, index: int) -> np.ndarray:
    return np.rot90(np.take(values, index, axis=axis))


def render(source: Path, audit_path: Path, output: Path) -> None:
    """Write the declared sample comparison to ``output`` as a PDF."""
    import matplotlib.pyplot as plt
    from matplotlib.backends.backend_pdf import PdfPages
    from matplotlib.colors import TwoSlopeNorm

    audit = json.loads(audit_path.read_text())
    rows = pd.read_parquet(source / "gene-expression.pqt")
    ids = rows["id"].astype(str).tolist()
    id_to_index = {experiment_id: index for index, experiment_id in enumerate(ids)}
    original = np.memmap(source / "gene-expression.bin", dtype="<f2", mode="r", shape=SHAPE)
    processed = np.memmap(source / PROCESSED_NAME, dtype="<f2", mode="r", shape=SHAPE)
    labels = np.load(source / "label.npy")
    inside = labels != 0
    output.parent.mkdir(parents=True, exist_ok=True)

    axes = ((2, "Coronal"), (0, "Sagittal"), (1, "Horizontal"))
    metadata = {
        "Title": "AGEA original and processed comparison",
        "CreationDate": datetime(2026, 9, 17, 12, 0, tzinfo=timezone.utc),
        "ModDate": datetime(2026, 9, 17, 12, 0, tzinfo=timezone.utc),
    }
    with PdfPages(output, metadata=metadata) as pdf:
        fig = plt.figure(figsize=(11.7, 8.3), layout="constrained")
        fig.suptitle("AGEA processed-source review", fontsize=20, fontweight="bold")
        text = (
            "Exact IBL processed source compared with the pinned original AGEA export.\n\n"
            f"Processed SHA-256: {audit['source']['sha256']}\n\n"
            f"Catalog: {audit['source']['catalog_experiments']:,} experiments · "
            f"{audit['anatomical_domain']['voxels_per_experiment']:,} valid coarse-label voxels per experiment\n"
            f"Bilateral symmetry: {audit['bilateral_symmetry']['symmetric_experiments']:,}/"
            f"{audit['bilateral_symmetry']['experiment_count']:,} experiments exact\n"
            f"Originally measured in-brain values changed: "
            f"{audit['comparison_to_original_inside_label']['changed_fraction']:.4%}\n\n"
            + textwrap.fill(
                "Processed validity in the candidate release is label.npy != 0. Value sign and exact -1 "
                "equality are not missingness after PPCA reconstruction. Registration remains provisional.",
                width=88,
            )
        )
        fig.text(0.08, 0.82, text, va="top", fontsize=12, linespacing=1.6)
        pdf.savefig(fig)
        plt.close(fig)

        for experiment_id in DEFAULT_SAMPLES:
            index = id_to_index[experiment_id]
            gene = str(rows.iloc[index]["gene"])
            raw = np.asarray(original[index], dtype=np.float32)
            clean = np.asarray(processed[index], dtype=np.float32)
            original_valid = inside & (raw >= 0)
            combined = np.concatenate((raw[original_valid], clean[inside]))
            vmin, vmax = np.quantile(combined, (0.01, 0.99))
            differences = clean - raw
            difference_limit = float(np.quantile(np.abs(differences[original_valid]), 0.99))
            difference_limit = max(difference_limit, np.finfo(np.float32).eps)
            fig, panels = plt.subplots(3, 3, figsize=(11.7, 8.3))
            fig.subplots_adjust(left=0.04, right=0.98, bottom=0.09, top=0.90, wspace=0.35, hspace=0.38)
            fig.suptitle(f"{gene} · experiment {experiment_id}", fontsize=17, fontweight="bold")
            for column, (axis, title) in enumerate(axes):
                plane_index = raw.shape[axis] // 2
                for row, (values, label) in enumerate(
                    ((raw, "Original"), (clean, "Processed"), (differences, "Difference"))
                ):
                    mask = (
                        (~inside | (raw < 0))
                        if row == 0
                        else ~inside
                        if row == 1
                        else (~inside | ~original_valid)
                    )
                    image = np.ma.array(values, mask=mask)
                    if row < 2:
                        artist = panels[row, column].imshow(
                            _plane(image, axis, plane_index), cmap="viridis", vmin=vmin, vmax=vmax
                        )
                    else:
                        artist = panels[row, column].imshow(
                            _plane(image, axis, plane_index), cmap="coolwarm",
                            norm=TwoSlopeNorm(vcenter=0, vmin=-difference_limit, vmax=difference_limit),
                        )
                    panels[row, column].set_title(f"{title} · {label} · index {plane_index}", fontsize=9)
                    panels[row, column].set_xticks([])
                    panels[row, column].set_yticks([])
                    fig.colorbar(artist, ax=panels[row, column], fraction=0.046, pad=0.02)
            sample = audit["samples"][experiment_id]
            fig.text(
                0.04, 0.025,
                f"Original missing inside: {sample['original_missing_inside']:,} · "
                f"changed measured values: {sample['changed_original_measurements']:,}/"
                f"{sample['original_measured_inside']:,} · mean absolute difference: "
                f"{sample['measured_inside_mean_absolute_difference']:.4g}",
                fontsize=9,
            )
            pdf.savefig(fig)
            plt.close(fig)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument(
        "--audit", type=Path, default=Path("docs/data/AGEA_PROCESSED_SOURCE_AUDIT.json")
    )
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    render(args.source, args.audit, args.output)
    print(args.output)


if __name__ == "__main__":
    main()
