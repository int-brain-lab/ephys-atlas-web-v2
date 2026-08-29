# IBL Ephys Atlas

Status: reader-facing documentation index; not a product or scientific
authority.

IBL Ephys Atlas Web v2 turns explicit regional or voxel scalar data into a
validated, immutable schema-v1 release that can be explored from static public
storage or imported locally in a browser. The local import path does not upload
the archive.

## Choose a path

- To author a dataset, start with the
  [regional authoring tutorial](data/CUSTOM_DATA_TUTORIAL.md) or browse the
  [executable examples](guides/examples.md).
- To look up Python signatures and public objects, use the
  [Python API reference](reference/python-api.md).
- To understand what is implemented and what remains blocked, read the
  [integration status](INTEGRATION_STATUS.md) and
  [open questions](OPEN_QUESTIONS.md).
- To work on the repository, start with the
  [system overview](SYSTEM_OVERVIEW.md) and repository `AGENTS.md` rather than
  treating this reader index as an implementation plan.

## Authority at a glance

| Need | Authority |
| --- | --- |
| Product launch requirements | [Launch specification](LAUNCH_SPEC.md) |
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

## Maturity labels

Synthetic examples and fixtures prove behavior only. They are not scientific
releases. A locally validated real archive is also distinct from staging and
published production data. The authoritative maturity definitions live in the
[system overview](SYSTEM_OVERVIEW.md#artifact-maturity).
