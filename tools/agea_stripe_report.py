"""Reproduce source evidence and screen the original AGEA catalog for review.

Run with the committed builder environment; output stays in ignored artifacts.
No input is repaired and no AGEA scientific release is constructed.
"""
from __future__ import annotations

import argparse
from collections import Counter
from dataclasses import asdict
from datetime import datetime, timezone
import csv
import hashlib
import io
import json
from pathlib import Path
import platform
import subprocess
import sys
import time
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

import numpy as np
import pandas as pd
from scipy import ndimage

from tools.agea_benchmark import SHAPE, SOURCE_HASHES, sha256, verify
from tools.agea_stripes import Parameters, Screen, synthetic_cases


REFERENCES = [
    ("Allen adult mouse acquisition and processing", "https://brain-map.org/support/documentation/api-for-mouse-brain-atlas"),
    ("Allen Alignment3d: transform direction and encoding", "https://api.brain-map.org/doc/Alignment3d.html"),
    ("Allen SectionDataSet: reference_to_image implementation", "https://api.brain-map.org/doc/SectionDataSet.html"),
    ("Allen expression grid download and missing sentinel", "https://brain-map.org/support/tutorials/downloading-3-d-expression-grid-data"),
    ("Pinned IBL PPCA / bilateral averaging / curtaining", "https://github.com/int-brain-lab/iblatlas/blob/52083adf44825d0622a503705e095699a5957587/iblatlas/genomics/gene_expression_scrapping/06-denoise-impute.py"),
]


def write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, indent=2, allow_nan=False) + "\n")


def verify_subset(source: Path, output: Path) -> None:
    """Explicit network step; cache exact downloads with acquisition receipts."""
    from tools.agea_source_verification import verify_experiment
    summary = json.loads((output / "summary.json").read_text())
    scores = json.loads((output / "scores.json").read_text())
    rows = pd.read_parquet(source / "gene-expression.pqt").to_dict("records")
    for name, expected in SOURCE_HASHES.items():
        verify(source / name, expected)
    values = np.memmap(source / "gene-expression.bin", dtype="<f2", mode="r", shape=SHAPE)
    by_id = {str(row["id"]): i for i, row in enumerate(rows)}
    ranking = sorted(scores, key=lambda r: -(r["slab"]["score"] or 0))
    selected = list(dict.fromkeys(["858"] + [r["experiment_id"] for r in ranking[:3]]
                                 + [ranking[-1]["experiment_id"], summary["random_ids"][0]]))
    results = []
    for id_ in selected:
        archive = output / f"downloads/allen-{id_}.zip"
        receipt_path = archive.with_suffix(".download.json")
        url = f"https://api.brain-map.org/grid_data/download/{id_}"
        if not archive.exists():
            now = datetime.now(timezone.utc).isoformat()
            with urllib.request.urlopen(url, timeout=90) as response:
                raw = response.read(16 * 1024 * 1024 + 1)
                if len(raw) > 16 * 1024 * 1024:
                    raise ValueError("Unexpected oversized archive")
                archive.write_bytes(raw)
                receipt = dict(url=url, downloaded_utc=now, bytes=len(raw),
                               sha256=sha256(archive), etag=response.headers.get("ETag"),
                               last_modified=response.headers.get("Last-Modified"))
            write_json(receipt_path, receipt)
        elif not receipt_path.exists():
            write_json(receipt_path, dict(url=url, downloaded_utc=None,
                       note="Existing session download; acquisition time not recorded. File mtime is not asserted as download time.",
                       bytes=archive.stat().st_size, sha256=sha256(archive)))
        receipt = json.loads(receipt_path.read_text())
        verify(archive, receipt["sha256"])
        if receipt.get("downloaded_utc") is None and not receipt.get("rechecked_utc"):
            now = datetime.now(timezone.utc).isoformat()
            with urllib.request.urlopen(url, timeout=90) as response:
                raw = response.read(16 * 1024 * 1024 + 1)
            current_hash = hashlib.sha256(raw).hexdigest()
            with zipfile.ZipFile(io.BytesIO(raw)) as fresh, zipfile.ZipFile(archive) as cached:
                if any(fresh.read(name) != cached.read(name) for name in ("energy.mhd", "energy.raw", "data_set.xml")):
                    raise ValueError("Current Allen members differ from cached source; review required")
            repeat_name = f"allen-{id_}-recheck-{current_hash[:12]}.zip"
            (output / "downloads" / repeat_name).write_bytes(raw)
            receipt.update(rechecked_utc=now, recheck_sha256=current_hash, recheck_file=repeat_name,
                           note="Three required members identical on recorded re-download; ZIP container bytes may differ. Original acquisition time unavailable.")
            write_json(receipt_path, receipt)
        result = verify_experiment(archive, values[by_id[id_]])
        result.update(experiment_id=id_, gene=rows[by_id[id_]]["gene"], download=receipt)
        results.append(result)
        print(f"Verified Allen {id_}: {result['comparison']['float16_full_volume_equal']}", flush=True)
    write_json(output / "direct-source-subset.json", results)
    summary["direct_source_subset"] = dict(selection_rule="Ptpru + top3 slab + lowest slab + first seeded random; deduplicated",
        ids=selected, checked=len(results), matches=sum(r["comparison"]["float16_full_volume_equal"] for r in results),
        evidence_file="direct-source-subset.json")
    write_json(output / "summary.json", summary)
    adjacent_path = output / "downloads/allen-858-adjacent-image-receipt.json"
    if adjacent_path.exists():
        adjacent = json.loads(adjacent_path.read_text())
        for entry in adjacent["images"]:
            verify(output / "downloads" / entry["file"], entry["sha256"])
    else:
        sections = json.loads((output / "ptpru-sections.json").read_text())
        images = sections["images"]
        neighbours = [max(im["section"] for im in images if im["section"] < 42),
                      min(im["section"] for im in images if im["section"] > 42)]
        entries = []
        for number in neighbours:
            im = next(im for im in images if im["section"] == number)
            url = f"https://api.brain-map.org/api/v2/image_download/{im['id']}?downsample=3&quality=85"
            name = f"allen-858-section-{number}-image-{im['id']}.jpg"
            with urllib.request.urlopen(url, timeout=90) as response:
                raw = response.read(16 * 1024 * 1024 + 1)
            if len(raw) > 16 * 1024 * 1024:
                raise ValueError("Unexpected oversized thumbnail")
            (output / "downloads" / name).write_bytes(raw)
            entries.append(dict(section_number=number, image_id=im["id"], url=url, file=name,
                                bytes=len(raw), sha256=hashlib.sha256(raw).hexdigest(),
                                xml_failed=im["failed"] == "true"))
        write_json(adjacent_path, dict(retrieved_at=datetime.now(timezone.utc).isoformat(),
                   selection=dict(reason="Available images adjacent to absent section 42", section_thickness_um=25),
                   images=entries))


def export_evidence(output: Path, destination: Path) -> None:
    """Small durable evidence; large profiles/volumes/PDF stay under artifacts."""
    summary = json.loads((output / "summary.json").read_text())
    sections = json.loads((output / "ptpru-sections.json").read_text())
    direct = json.loads((output / "direct-source-subset.json").read_text())
    compact = {k: v for k, v in summary.items() if k not in {"controls", "sensitivity", "ptpru", "elapsed_seconds"}}
    compact["controls"] = {name: {"slab_score": r["slab"]["score"], "intensity_score": r["intensity"]["score"]}
                           for name, r in summary["controls"].items()}
    compact["ptpru"] = {k: v for k, v in summary["ptpru"].items() if k not in {"missing_profiles", "intensity"}}
    compact["mask_sensitivity"] = {erosion: {id_: dict(slab_score=r["slab"]["score"], missing_interior=r["missing_interior"])
                                           for id_, r in records.items()}
                                  for erosion, records in summary["sensitivity"].items()}
    compact["ptpru_sections"] = {k: v for k, v in sections.items() if k != "images"}
    compact["direct_source_checks"] = direct
    receipt = output / "downloads/allen-858-adjacent-image-receipt.json"
    if receipt.exists():
        compact["adjacent_images"] = json.loads(receipt.read_text())
    compact["report"] = dict(path=str(output / "report.pdf"), sha256=sha256(output / "report.pdf"))
    compact["render_evidence"] = json.loads((output / "render-evidence.json").read_text())
    destination.mkdir(parents=True, exist_ok=True)
    write_json(destination / "AGEA_STRIPE_EVIDENCE.json", compact)
    # Round descriptive CSV scores only for compact storage; full precision in artifacts.
    with (output / "scores.csv").open() as stream:
        reader = csv.DictReader(stream)
        rows = list(reader)
        fields = reader.fieldnames
    with (destination / "AGEA_STRIPE_SCORES.csv").open("w", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        for row in rows:
            for key in fields[2:]:
                if row[key]:
                    row[key] = f"{float(row[key]):.6g}"
            writer.writerow(row)
    (destination / "AGEA_STRIPE_REGIONS.json").write_bytes((output / "regions.json").read_bytes())


def section_evidence(path: Path, values: np.ndarray, labels: np.ndarray) -> dict:
    """Apply Allen's published reference_to_image section-axis calculation.

    MetaImage xyz = (AP,DV,ML) source axes, with header spacing and offset.
    This does not compose AGEA with the production 10 um anatomy.
    """
    with zipfile.ZipFile(path) as archive:
        root = ET.fromstring(archive.read("data_set.xml"))
        header = dict(line.split(" = ", 1) for line in archive.read("energy.mhd").decode().splitlines() if " = " in line)
    spacing = np.fromstring(header["ElementSpacing"], sep=" ")
    offset = np.fromstring(header["Offset"], sep=" ")
    matrix = np.fromstring(header["TransformMatrix"], sep=" ").reshape(3, 3)
    coords = np.indices(values.shape, dtype=float)[::-1].reshape(3, -1)
    reference = matrix @ (coords * spacing[:, None]) + offset[:, None]
    trv = np.fromstring(root.findtext("alignment3d/trv", ""), sep=",")
    tvr = np.fromstring(root.findtext("alignment3d/tvr", ""), sep=",")
    if trv.size != 12 or tvr.size != 12:
        raise ValueError("Expected both Allen 12-parameter transforms")
    specimen = trv[:9].reshape(3, 3) @ reference + trv[9:, None]
    roundtrip = tvr[:9].reshape(3, 3) @ specimen + tvr[9:, None]
    thickness = float(root.findtext("section-thickness", "nan"))
    if not np.isfinite(thickness) or thickness <= 0:
        raise ValueError("Missing section thickness")
    images = [dict(section=int(im.findtext("section-number")), id=im.findtext("id"),
                   failed=im.findtext("failed")) for im in root.findall("section-images/section-image")]
    numbers = sorted(im["section"] for im in images)
    step = Counter(np.diff(numbers).tolist()).most_common(1)[0][0]
    absent = sorted(set(range(numbers[0], numbers[-1] + 1, step)) - set(numbers))
    z = specimen[2].reshape(values.shape)
    inside = labels != 0
    interior = ndimage.binary_erosion(inside)
    missing = values == -1
    # Half the modal sampling interval on either side, explicitly exploratory.
    half_width = step * thickness / 2
    sections = []
    for number in sorted(numbers + absent):
        distance = abs(z - number * thickness)
        band = distance <= half_width
        populations = {}
        for name, mask in (("labelled", inside), ("interior", interior)):
            support = int(np.count_nonzero(band & mask))
            hits = int(np.count_nonzero(band & mask & missing))
            populations[name] = dict(support=support, missing=hits,
                                     fraction=hits / support if support else None)
        sections.append(dict(number=number, present=number in numbers, **populations))
    # Sensitivity to a one-section numbering offset and half-grid origin shift.
    sensitivity = []
    for grid_shift in (-.5, 0., .5):
        shift_z = float(trv[6:9] @ (matrix @ (spacing * grid_shift)))
        for number_shift in (-1, 0, 1):
            band = np.zeros(values.shape, dtype=bool)
            for number in absent:
                band |= abs(z + shift_z - (number + number_shift) * thickness) <= half_width
            support = int((band & interior).sum())
            hits = int((band & interior & missing).sum())
            sensitivity.append(dict(grid_shift_voxels=grid_shift, section_shift=number_shift,
                                    support=support, missing=hits,
                                    fraction=hits / support if support else None))
    return dict(experiment_id=root.findtext("id"), specimen_id=root.findtext("specimen-id"),
                reference_space_id=root.findtext("reference-space-id"),
                section_thickness_um=thickness, modal_section_step=step, absent_numbers=absent,
                images=images, trv=trv.tolist(), tvr=tvr.tolist(),
                roundtrip_max_error_um=float(abs(reference - roundtrip).max()),
                band_half_width_um=half_width, sections=sections, sensitivity=sensitivity,
                mapping="Header xyz physical coordinates -> trv -> specimen z; section*thickness per Allen code",
                limitation="Grid-to-API reference identity is tested as a source-coordinate hypothesis; no production registration approval. Missing records do not prove damaged sections.")


def run(source: Path, output: Path) -> None:
    started = time.monotonic()
    sources = {name: verify(source / name, digest) for name, digest in SOURCE_HASHES.items()}
    rows = pd.read_parquet(source / "gene-expression.pqt").to_dict("records")
    if len(rows) != SHAPE[0] or len({str(r["id"]) for r in rows}) != SHAPE[0]:
        raise ValueError("Unexpected catalog identity")
    values = np.memmap(source / "gene-expression.bin", dtype="<f2", mode="r", shape=SHAPE)
    labels = np.load(source / "label.npy", allow_pickle=False)
    if labels.shape != SHAPE[1:]:
        raise ValueError("Unexpected label shape")
    output.mkdir(parents=True, exist_ok=True)
    parameters = Parameters()
    screen = Screen(labels, parameters)
    controls_labels, controls = synthetic_cases()
    controls_screen = Screen(controls_labels, Parameters(min_support=30))
    controls_scores = {name: controls_screen.score(v) for name, v in controls.items()}
    results = []
    frequency = np.zeros(labels.shape, dtype=np.uint16)
    unique_regions, inverse_regions = np.unique(labels, return_inverse=True)
    region_missing = np.zeros(len(unique_regions), dtype=np.int64)
    region_support = np.bincount(inverse_regions.ravel())
    for index, row in enumerate(rows):
        result = screen.score(values[index])
        result.update(experiment_id=str(row["id"]), gene=str(row["gene"]))
        results.append(result)
        missing = values[index] == -1
        frequency += missing
        region_missing += np.bincount(inverse_regions.ravel(), weights=missing.ravel()).astype(np.int64)
        if (index + 1) % 250 == 0:
            print(f"Screened {index + 1}/{len(rows)} in {time.monotonic() - started:.1f}s", flush=True)
    write_json(output / "scores.json", results)
    np.save(output / "missing-frequency.npy", frequency, allow_pickle=False)
    fields = ["experiment_id", "gene", "missing_all", "missing_labelled", "missing_interior", "missing_boundary", "largest_connected_gap", "slab_score", "intensity_score"]
    with (output / "scores.csv").open("w", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        writer.writerows({**{k: r[k] for k in fields[:-2]}, "slab_score": r["slab"]["score"],
                          "intensity_score": r["intensity"]["score"]} for r in results)
    from iblatlas.genomics import agea
    atlas = agea.load_atlas(source)
    regions = [dict(supplied_label_index=int(region), region_id=int(atlas.regions.id[region]),
                    acronym=str(atlas.regions.acronym[region]), name=str(atlas.regions.name[region]),
                    spatial_support=int(n),
                    experiment_voxel_support=int(n) * len(rows), missing_count=int(m),
                    missing_fraction=float(m / (n * len(rows))))
               for region, n, m in zip(unique_regions, region_support, region_missing)]
    write_json(output / "regions.json", regions)
    ranked = sorted(results, key=lambda r: -(r["slab"]["score"] or 0))
    intensity_ranked = sorted(results, key=lambda r: -(r["intensity"]["score"] or 0))
    rng = np.random.default_rng(20260907)
    random_ids = [results[i]["experiment_id"] for i in rng.choice(len(results), 3, replace=False)]
    selected = list(dict.fromkeys(["858"] + [r["experiment_id"] for r in ranked[:3]]
                                 + [r["experiment_id"] for r in ranked[-2:]]
                                 + [r["experiment_id"] for r in intensity_ranked[:2]] + random_ids))
    # Repeat-experiment examples selected by largest within-gene slab-score range.
    groups = {}
    for r in results:
        groups.setdefault(r["gene"], []).append(r)
    repeated = sorted((g for g in groups.values() if len(g) > 1),
                      key=lambda g: -(max(r["slab"]["score"] or 0 for r in g)
                                      - min(r["slab"]["score"] or 0 for r in g)))[:5]
    by_id = {r["experiment_id"]: i for i, r in enumerate(results)}
    archive = output / "downloads/allen-858.zip"
    from tools.agea_source_verification import verify_experiment
    direct = verify_experiment(archive, values[by_id["858"]])
    sections = section_evidence(archive, values[by_id["858"]], labels)
    write_json(output / "ptpru-source.json", direct)
    write_json(output / "ptpru-sections.json", sections)
    sensitivity = {}
    for erosion in (0, 1, 2):
        alternate = Screen(labels, Parameters(erosion=erosion))
        sensitivity[str(erosion)] = {id_: alternate.score(values[by_id[id_]]) for id_ in selected}
    slab_values = np.array([r["slab"]["score"] for r in results], dtype=float)
    summary = dict(status="Exploratory screening; no scientific QC or release selection", sources=sources,
                   experiments=len(rows), gene_symbols=len(groups), parameters=asdict(parameters),
                   directions=len(screen.directions), controls=controls_scores,
                   detector_development="Shallow slopes added after initial Ptpru investigation; synthetic controls are engineering validation, not held-out scientific validation.",
                   independent_reader="No established MetaImage library available in locked environment; complete NumPy decode plus struct.unpack offsets, not two independent full-volume libraries.",
                   mask_support=dict(labelled=int(screen.mask.sum()), interior=int(screen.interior.sum())),
                   missing_labelled_quantiles=np.quantile([r["missing_labelled"] for r in results], [.05, .5, .95]).tolist(),
                   slab_threshold_counts={str(t): int(np.count_nonzero(slab_values >= t)) for t in (.3, .5, .7)},
                   selected_ids=selected, random_ids=random_ids,
                   selection_rule="Ptpru + top 3/bottom 2 slab + top 2 intensity + 3 random (seed 20260907); deduplicated",
                   repeated_experiments=[[dict(experiment_id=r["experiment_id"], gene=r["gene"],
                                               slab_score=r["slab"]["score"], intensity_score=r["intensity"]["score"])
                                          for r in g] for g in repeated],
                   ptpru=results[by_id["858"]], sensitivity=sensitivity,
                   references=[dict(title=title, url=url) for title, url in REFERENCES],
                   manual_review="No scientist adjudication; displayed examples require review. Flags are not confirmed problems.",
                   metadata_coverage="Section/specimen metadata acquired for direct-source subset only; unavailable for remaining catalog.",
                   environment=dict(commit=subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip(),
                                    python=platform.python_version(), numpy=np.__version__, platform=platform.platform(),
                                    command=sys.argv, generated_utc=datetime.now(timezone.utc).isoformat(),
                                    lock_sha256=sha256(Path("builder/uv.lock")),
                                    scripts={p: sha256(Path(p)) for p in ["tools/agea_stripes.py", "tools/agea_stripe_report.py", "tools/agea_source_verification.py"]}),
                   elapsed_seconds=time.monotonic() - started)
    write_json(output / "summary.json", summary)
    print(f"Completed screening in {time.monotonic() - started:.1f}s", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--verify-samples", action="store_true", help="Download/verify bounded Allen subset after screening")
    parser.add_argument("--evidence-dir", type=Path, help="Export compact evidence after PDF and source checks exist")
    args = parser.parse_args()
    if args.evidence_dir:
        export_evidence(args.output, args.evidence_dir)
    elif args.verify_samples:
        verify_subset(args.source, args.output)
    else:
        run(args.source, args.output)
