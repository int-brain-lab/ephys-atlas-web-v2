# Documentation authority map

Status: reader index derived from the active
[system overview](../SYSTEM_OVERVIEW.md#documentation-authority). The overview
is authoritative if this summary drifts.

Documentation in this repository has scoped authority. A tutorial can explain
how to use an accepted contract, but it cannot redefine the schema or resolve a
scientific blocker. A generated API page can show the current signature, but it
cannot choose a population, affine, or publication default.

| Label | Meaning | Primary documents |
| --- | --- | --- |
| Active product specification | Defines launch acceptance | [Launch specification](../LAUNCH_SPEC.md) |
| Active architecture | Defines stable system boundaries | [System overview](../SYSTEM_OVERVIEW.md), [architecture](../ARCHITECTURE.md) |
| Accepted decision record | Defines effective policy and product choices | [Decisions](../DECISIONS.md) |
| Active execution registry | Lists incomplete, executable work | [Implementation plan](../IMPLEMENTATION_PLAN.md) |
| Active blocker registry | Lists choices an agent must not infer | [Open questions](../OPEN_QUESTIONS.md) |
| Active focused contract | Defines one subsystem's binding behavior | [Custom authoring](../data/CUSTOM_DATA_AUTHORING.md) and other focused documents |
| Runbook or tutorial | Explains an operational/user path under those contracts | [Regional authoring tutorial](../data/CUSTOM_DATA_TUTORIAL.md) |
| Generated API reference | Reflects current public Python objects and docstrings | [Python API](python-api.md) |
| Frozen evidence | Records why a candidate was accepted or rejected | Focused audit, benchmark, and review documents |

Implementation truth is the code and tests. Its durable summary is the
[integration status](../INTEGRATION_STATUS.md). Scientific source identity and
recipes live under [data source records](../data/README.md). The sole release
wire contract is schema v1 under `schema/v1/` in the repository; the MkDocs
site does not copy or reinterpret those schemas.
