# IBL Ephys Atlas

Status: reader-facing documentation index; not a product or scientific
authority.

IBL Ephys Atlas Web v2 provides a shared anatomical framework for exploring
regional summaries, voxel-scale electrophysiology features, and brain-wide
analysis results. Every dataset resolves to an immutable, provenance-rich
release that can be explored from static public storage or imported locally in
a browser.

## Explore data

Open **Help** in the viewer for a compact Quick Start or a guided walkthrough
of the visible controls. For a complete introduction, read:

- [Use the viewer](guides/using-the-viewer.md) — choose data, navigate linked
  views, inspect values, interpret displays, share, and download;
- [Understand parcellations](guides/parcellations.md) — learn how Allen, Beryl,
  and Cosmos affect regional data and volume anatomy overlays.

Available datasets and features come from the selected public catalog and
immutable release. This documentation does not maintain a competing hardcoded
dataset list.

## Author and import your data

The local workflow creates a validated schema-v1 ZIP and imports it into
browser-local storage without uploading it:

- start with the [custom-data tutorial](data/CUSTOM_DATA_TUTORIAL.md);
- browse the [executable examples](guides/examples.md);
- look up signatures in the [Python API reference](reference/python-api.md).

The `ibl-ephys-atlas` distribution is not yet published to PyPI; the guides
show how to run it from the repository's locked environment.

## Technical and project reference

- To understand what is implemented and what remains blocked, read the
  [integration status](INTEGRATION_STATUS.md) and
  [open questions](OPEN_QUESTIONS.md).
- To work on the repository, start with the
  [system overview](SYSTEM_OVERVIEW.md) and repository `AGENTS.md` rather than
  treating this reader index as an implementation plan.

### Authority at a glance

| Need | Authority |
| --- | --- |
| Product launch requirements | [Launch specification](LAUNCH_SPEC.md) |
| Criterion-level launch evidence and gaps | [Launch-readiness audit](LAUNCH_READINESS_AUDIT.md) |
| System boundaries and data flow | [System overview](SYSTEM_OVERVIEW.md) and [architecture](ARCHITECTURE.md) |
| Accepted policy and product choices | [Effective decision index](DECISIONS.md) |
| Current implementation maturity | Code and tests, summarized by [integration status](INTEGRATION_STATUS.md) |
| Next implementation work | [Implementation plan](IMPLEMENTATION_PLAN.md) |
| Choices an implementer must not guess | [Open questions](OPEN_QUESTIONS.md) |
| Custom-authoring behavior | [Authoring and ZIP contract](data/CUSTOM_DATA_AUTHORING.md) |
| Scientific source identity and recipes | [Data source records](data/README.md) |
| Wire format | Schema v1 under `schema/v1/` in the repository |

The [full authority map](reference/authority.md) explains how these labels fit
together. Generated API pages describe the installed code; they do not replace
the schema, scientific source records, or accepted decisions.

### Maturity labels

Synthetic examples and fixtures prove behavior only. They are not scientific
releases. A locally validated real archive is also distinct from staging and
published production data. The authoritative maturity definitions live in the
[system overview](SYSTEM_OVERVIEW.md#artifact-maturity).
