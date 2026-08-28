# Documentation rationalization plan

Status: active repository-wide documentation refactor; implementation started
on 2026-08-29.

Baseline: `main` at `9c6ac3d` on 2026-08-29, after the D050 schema/frontend
cutover, the D051 custom-authoring decision, the D052 partial Q14 selection,
and the D053 compact-range correction.

## Outcome

Make the repository understandable end to end without weakening its scientific
record. A new collaborator should be able to learn how source data becomes a
validated immutable release, how it is published and consumed, what is current,
what remains blocked, and where the supporting evidence lives without reading
completed implementation diaries.

This is an authority-model refactor, not a prose-deletion exercise. Scientific
evidence and reproducibility records remain durable even when they leave the
default reading path.

## Current problems

The root startup set currently totals 3,439 lines across `AGENTS.md`, the launch
specification, implementation plan, open questions, architecture, decisions,
integration status, and root README. The main problems are role drift and
duplication rather than missing information:

- `docs/IMPLEMENTATION_PLAN.md` mixes active work with long completed milestone
  narratives.
- `docs/OPEN_QUESTIONS.md` contains fourteen numbered questions although only
  Q2, Q5, the unresolved part of Q8, Q9, and the unresolved part of Q14 remain
  open.
- `docs/INTEGRATION_STATUS.md` is both a current-state reference and a detailed
  implementation diary. It contains mutually incompatible historical and
  current statements about 3-D integration and D050 completion.
- `docs/ARCHITECTURE.md` mixes stable boundaries with exact distribution
  formulas, migration instructions, decoder details, and obsolete Q12 wording.
- `docs/DECISIONS.md` is a 999-line append-only record without a compact
  effective-status and supersession index.
- `docs/DATA_SOURCES.md`, `docs/data/PROVENANCE.md`, recipes, release reports,
  and handoffs repeat source and provenance facts without consistently naming
  the owning record.
- completed labs, cutover plans, evidence, current runbooks, and stale handoffs
  coexist in focused directories without a clear document-role index.
- stable document paths also appear in code diagnostics and bare backticked
  references, so moving Markdown files can break more than ordinary links.

The D050 work is no longer a sequencing blocker. It is implemented, rebuilt
locally, and green. The refactor must incorporate the newer authority split:

- D050 defines the implemented distribution contract;
- D052 is the only new feature-specific Q14 selection so far;
- `docs/data/DISTRIBUTION_AUDIT.md` is the active runbook for the remaining Q14
  review and rollout;
- D051 and `docs/data/CUSTOM_DATA_AUTHORING.md` are accepted direction and an
  active focused plan, not historical handoff material.

## Document roles and authority

The refactor should use the following roles. There is no universal precedence
list because different documents answer different questions.

| Question | Owning document or artifact |
| --- | --- |
| What is the system and how does data flow through it? | `docs/SYSTEM_OVERVIEW.md` |
| What must launch? | `docs/LAUNCH_SPEC.md` |
| What policy or product choice is accepted? | Effective decision index and the relevant decision body |
| What is implemented now? | Code and tests, summarized by `docs/INTEGRATION_STATUS.md` |
| What should be done next? | `docs/IMPLEMENTATION_PLAN.md` and an explicitly linked focused plan/runbook |
| What must an agent not choose? | `docs/OPEN_QUESTIONS.md` |
| What is the scientific source and recipe? | Dataset source/recipe authority and machine-readable selection artifacts |
| What is the wire/release contract? | `schema/v1/` and `schema/v1/README.md` |
| Why was a choice accepted or rejected? | Frozen decision, audit, benchmark, or review evidence |
| How is a local operational task performed? | An explicitly labelled runbook |

Use a small status vocabulary near the top of documents whose role is not
obvious:

- `active` — current normative or execution authority;
- `accepted` — approved decision or contract;
- `blocked` — active but awaiting named authority or external state;
- `runbook` — current reproducible operational procedure;
- `frozen evidence` — completed evidence that remains scientifically relevant;
- `superseded` — historical authority replaced by a named document/decision;
- `retired` — no longer executable or authoritative.

Record `Last reviewed` and `Superseded by` only where they clarify authority.
Do not add volatile ownership metadata to every file merely to create another
maintenance burden.

Artifact maturity must remain separate from document status. Use the existing
scientific distinctions consistently: synthetic/test-only,
validated-real-local, staging, and published-production.

## Target default reading path

Add one concise `docs/SYSTEM_OVERVIEW.md` that combines the end-to-end narrative
and documentation map. It should explain, in plain language:

```text
canonical scientific source
    -> pinned source bytes and explicit scientific recipe
    -> dataset-specific Python builder
    -> shared deterministic schema-v1 serialization and validation
    -> immutable release plus provenance
    -> authorized publication to object storage/CDN
    -> catalog and aliases outside immutable releases
    -> verified HTTP or local resource reader
    -> browser application session
    -> retained 2-D/optional 3-D rendering and UI
```

It must distinguish canonical scientific objects from browser transport,
scientific transformation from publication, published releases from aliases,
and synthetic fixtures from real releases. It should link to deeper documents
rather than repeat their details.

After the overview exists, revise the root README and `AGENTS.md` reading order
so every agent reads the current control plane and only the relevant decision
bodies and focused evidence for its task. Keep the launch specification in the
required path. Measure the before/after startup path and aim to reduce it by at
least half without removing launch acceptance or scientific guardrails.

## Execution plan

### 1. Establish navigation without moving files

1. Add `docs/SYSTEM_OVERVIEW.md` with the system flow, subsystem boundaries,
   document authority table, and artifact-maturity vocabulary.
2. Link it from the root README and the agent startup instructions.
3. Add lightweight index files only in focused directories where they remove
   real ambiguity, beginning with `docs/data/` and `docs/rendering/`.
4. Classify current focused documents as contract, active plan/runbook, frozen
   evidence, or superseded/retired material.

Acceptance:

- a new collaborator can locate the product requirements, current blockers,
  schema contract, dataset recipes, publishing boundary, and rendering evidence
  from the overview;
- no existing path moves in this slice;
- all local links and bare repository-path references still resolve.

### 2. Repair current factual drift

Make one coherent contradiction-repair pass before shortening documents. At
minimum, reconcile:

- resolved Q1/Q4/Q6/Q7/Q11/Q12/Q13 statements in source, handoff, rendering,
  README, and architecture documents;
- the old `docs/INTEGRATION_STATUS.md` statement that 3-D is not integrated
  with the later completed Commits 0-6 and 2026-08-28 Safari/Firefox review;
- pre-D050 “future cutover” and “finish local D050 rebuilds” text with the
  implemented contract and validated local releases;
- D052's narrow `peak_val.raw` resolution with the still-open remainder of Q14;
- the difference between keeping the separately deployed v1 available as an
  operational launch fallback and refusing v1 runtime compatibility inside v2;
- user-facing code diagnostics that point to stale handoff or provenance
  authorities.

Historical plans may describe the assumptions at the time, but their status
banner must prevent those assumptions from being mistaken for current truth.

Acceptance:

- active documents do not contradict current decisions or code/tests;
- repository searches for resolved-question language return only deliberately
  historical evidence or explicit resolution text;
- diagnostics and runbooks send users to current authorities.

### 3. Rewrite the three current registries

Refactor `docs/IMPLEMENTATION_PLAN.md` to contain incomplete executable work.
Each lane should state status, blocker, next testable action, acceptance link,
and evidence/runbook link. Move completed narrative out of the default path
without deleting evidence.

Refactor `docs/OPEN_QUESTIONS.md` to contain only unresolved questions. Preserve
stable Q identifiers in a compact `docs/RESOLVED_QUESTIONS.md` index mapping
each closed question to its decision and primary evidence. Active references
should cite the effective decision/selection rather than continuing to treat a
closed Q as authority.

Refactor `docs/INTEGRATION_STATUS.md` into a concise capability matrix that
distinguishes:

- implemented machinery;
- synthetic contract/browser validation;
- validated real local releases;
- staged or published production state;
- remaining blockers and next work.

Include the reviewed commit/date and link to measurements and release records
instead of copying their narratives.

Acceptance:

- no completed milestone remains in the active plan except as a one-line
  dependency summary;
- no resolved item remains in `OPEN_QUESTIONS.md`;
- integration status can be refreshed without rewriting architecture or lab
  history;
- Q2, Q5, residual Q8, Q9, and residual Q14 remain explicit and unweakened.

### 4. Refocus architecture and data ownership

Keep `docs/ARCHITECTURE.md` focused on stable boundaries:

- dependency direction and application composition;
- dataset and representation model;
- immutable release and public/local parity;
- reference-space, grid, and asset identity;
- retained 2-D and sibling optional 3-D boundaries;
- builder versus publishing responsibility;
- high-level integrity and cache identity.

Move or link exact formulas, schema field semantics, worker/codec mechanics,
asset inventories, and completed migration narration to decisions, schema, or
focused contracts.

For data documentation, consolidate by ownership rather than creating one
mega-document:

- `docs/data/README.md` maps each dataset to its source authority, scientific
  recipe, selection artifact, release record, and active audit/runbook;
- each dataset has one named owner for current source/recipe facts;
- release/evidence reports remain separate and frozen;
- `docs/data/PROVENANCE.md` becomes a short cross-dataset requirements document
  or a clearly labelled dataset inventory, not a duplicate source catalog;
- `docs/DATA_SOURCES.md` remains a stable compatibility entry point and points
  to the owning dataset records.

Do not move or rename machine-readable selection JSON consumed by builders in
the same slice as prose consolidation unless all consumers and tests are
updated atomically.

Acceptance:

- every scientific source hash, recipe, owner approval, and reproduction
  command has one durable owning record;
- overview/source documents link to evidence rather than duplicating it;
- D050-D053 distribution authorities and D051 custom-authoring boundaries stay
  explicit.

### 5. Add an effective decision index

Keep `docs/DECISIONS.md` at its stable path initially. Add a compact index with
decision ID, title, effective status, date, scope, and supersession target.
For each decision, distinguish `accepted`, `superseded`, and `partially
superseded`. For partial supersession, state which clauses remain effective.

Decision status is not implementation status. For example, D051 is accepted
while its implementation is not started; D052 is accepted while most of Q14
remains open.

Do not rewrite historical decision bodies to make them sound current. A reader
must be able to see why D013-D016, D023-D026, D041, and D046-D050 were changed
without applying their superseded clauses accidentally.

Acceptance:

- a reader can identify the effective decision for schema, renderer boundary,
  volume geometry, 3-D geometry, and distribution presentation without reading
  all decision bodies;
- every `Supersedes`/`Superseded by` target exists;
- historical rationale remains unchanged and discoverable.

### 6. Rationalize handoffs, plans, and historical evidence

Prefer a virtual archive first: status banners plus indexes at stable paths.
Do not perform a bulk move to `docs/history/` before links and code references
are mechanically checked.

Split durable runbook content from transient next-action narration where they
are currently mixed. In particular, preserve W26 acquisition, checksums,
geometry authority, and reproducibility instructions even if the task-order
portion of `VOLUME_IMPLEMENTATION_HANDOFF.md` is retired. Preserve
`DISTRIBUTION_AUDIT.md` and `CUSTOM_DATA_AUTHORING.md` as active focused work.

A later physical archive may contain genuinely completed plans and retired
handoffs. For every moved, widely referenced path either update all repository
and code references atomically or leave a short compatibility stub naming the
new location and authority. Do not archive scientific evidence, selection
artifacts, release provenance, license authorization, or rejected-candidate
evidence merely because the associated review is complete.

Acceptance:

- no document called a handoff silently competes with the active plan;
- completed experiments state whether they changed production and which
  decision records the outcome;
- stable external-looking paths retain a useful compatibility destination.

### 7. Add documentation gates

Add `just docs-check` and include it in `just check` once the metadata and
structure have stabilized. It should validate:

- Markdown links and anchors;
- bare/backticked repository paths such as `docs/...` and `schema/...`;
- unique Q/D identifiers and valid supersession targets;
- no `RESOLVED` entry in `docs/OPEN_QUESTIONS.md`;
- required role/status headers for indexed focused documents;
- no active-plan milestone marked complete;
- no retired/superseded document labelled active.

The checker must parse source paths correctly rather than treating ripgrep's
`source-file:match` output as part of the target path. Keep the rules narrow
enough that evidence documents do not require meaningless metadata churn.

Acceptance:

- the gate detects a deliberately broken Markdown link, bare path, duplicate
  question/decision ID, invalid supersession, and resolved open question;
- `just check` remains aligned with CI and green.

## Information that must remain in the clean checkout

Git history is sufficient for discarded implementation narration, but not for
scientific or operational evidence required to reproduce or audit a release.
Retain durably:

- exact source identities, byte sizes, and hashes;
- source/tool/builder commits and commands;
- population, QC, transformation, aggregation, and validity recipes;
- machine-readable owner-reviewed selections;
- scientific-owner approvals and their scope;
- release identities and complete-graph validation evidence;
- benchmark summaries that support transport choices;
- rejected-candidate evidence that constrains future regeneration;
- licensing authorization;
- evidence for private, ignored, or local artifacts unavailable from a clean
  checkout.

## Suggested commit sequence

Implement this plan as reviewable green commits on `main`:

1. add the overview, authority vocabulary, and initial indexes;
2. repair contradictions and stale code/document references;
3. rewrite the active plan, open/resolved question registries, and integration
   status;
4. refocus architecture and consolidate data-document ownership;
5. add the effective decision index and supersession metadata;
6. rationalize handoffs/history with compatibility stubs where needed;
7. add `docs-check`, integrate it with `just check`, and record the final
   before/after reading-path measurement.

Each commit must preserve scientific provenance, update all affected
producer/consumer documentation coherently, run targeted documentation tests,
and finish with `just check` before handoff.

## Completion criteria

The rationalization is complete when:

1. a new scientific collaborator can explain the end-to-end source, recipe,
   provenance, build, validation, publication, and browser flow from the system
   overview;
2. a coding agent can find the next unblocked task and its guardrails without
   reading completed implementation diaries;
3. every document is classifiable as current authority, active plan/runbook,
   contract, current status, frozen evidence, superseded, or retired;
4. active documents do not contradict effective decisions or the shipped code;
5. all open scientific and deployment choices remain explicit;
6. scientific provenance and reproducibility evidence remain available in a
   clean checkout;
7. repository and code references resolve after any move;
8. the measured mandatory reading path is materially smaller, with a target of
   at least a 50% reduction from the 3,439-line baseline;
9. `just check` is green on the final commit.
