# Top-bar redesign: implementation handoff

Status: redesign implemented and validated on Linux; final commit/push in progress.
Owner direction recorded on 2026-09-05. This is a bounded UI task independent
of the blocked production launch lanes.

## Start prompt

Implement `docs/tasks/2026-09-05-top-bar-redesign/README.md` end to end.
Use subagents with different models and reasoning efforts as directed below,
make coherent green commits on `main` along the way, and push `main` at the
end after validation. Follow `AGENTS.md`. Do not stop at a plan or request
confirmation for actions already authorized in this brief.

## Authorization and scope

- The owner authorizes the future implementation agent to change the top bar,
  its tests and documentation, delegate bounded tasks, choose subagent models
  and efforts, commit milestones, and perform the final normal push to origin.
- This preparation task writes and commits the brief; it does not implement
  the redesign. Execution begins when a future agent is asked to pick it up.
- Work on `main`; no PR, persistent parallel branch, history rewrite, or force
  push. Preserve unrelated work. Only the lead stages, commits, and pushes.
- Routine UI decisions within this brief do not need renewed approval. No
  scientific release, catalog default/mapping change, deployment, publication,
  new framework, or large dependency is authorized.

## Problem and agreed direction

The current Project menu mixes projects, coordinated editions, and an
individual-release action. The header gives infrequent context decisions
similar prominence to feature exploration. Reduce that cognitive load while
keeping scientific identity inspectable.

- Replace separate Project and Dataset fields with one **Data** chooser.
  Show a compact closed breadcrumb such as `Ephys Atlas / Channels`.
  Inside, project names are clearly labelled groups and datasets are the
  selectable items. Ephys Atlas and Brain-Wide Map remain distinct groups;
  preserve **My data** as browser-local context, not a public project.
- Use catalog membership and ordering. Allow direct dataset selection without
  an obligatory project/edition wizard. Reuse existing navigation transitions
  so selecting a dataset across projects resolves the correct context and
  exact release atomically. Do not flatten away project identity.
- Make the existing searchable **Feature** control the most prominent control.
  Preserve its shortcuts, dynamic availability, and existing feature-selection
  and reconciliation behavior. Show readable metadata/units where supplied;
  do not invent labels or scientific units or hardcode a feature catalog.
- Give edition/release selection a compact, quieter control near Data. It
  must provide coordinated editions and exact dataset release selection with
  clear grouping, including **Choose releases individually** and explicit
  edition re-entry. Preserve visible coordinated/custom-baseline disclosure;
  a short version label alone is insufficient when it conceals an override.
  Exact release IDs and provenance remain accessible without hover alone.
- Distinguish local preview/development, preserved legacy, and browser-local
  data using existing metadata and source semantics. Example `2026 W32` copy
  from the discussion is illustrative, not a new default or edition identity.
- Move applicable view controls beside/above the visualization and use precise
  user-facing labels. The current **View** menu changes representation and
  parcellation, not merely slice orientation or layout: inspect these meanings
  before moving or splitting it. Preserve all available choices and shared
  state, including volume and optional 3-D interactions.
- Use opaque, readable popovers, concise descriptions, and one clear selected
  indicator. Avoid repeating the project name in dataset labels when reliable
  catalog presentation permits shortening; do not use brittle string stripping.
- Keep occasional actions visually quieter. At narrow widths, give Data and
  Feature space on two rows before truncating critical names. Keep release
  context accessible and avoid nested popovers or a second navigation model.

## Authority and current implementation

Read the required `AGENTS.md` sequence in order, then
`docs/AGENTIC_DEVELOPMENT.md`, `docs/ARCHITECTURE.md`, the effective decision
index and D056/D061, `docs/INTEGRATION_STATUS.md`, and
`docs/frontend/DATASET_NAVIGATION.md`. Follow their authority map for any
additional relevant schema/source/rendering documentation; do not read completed
implementation diaries by default.

Important conflict to resolve during implementation: D061 and the navigation
document currently prescribe **Project, Dataset, Feature, View** on wide
screens and a staged Data chooser on phones. The owner now approves the
presentation change above. Record a new decision refining only those UI rules,
update the effective decision index and focused navigation document, and clarify
LS01-08 if needed. Preserve the conceptual distinctions and every immutable
edition, custom-context, URL, and catalog-authority rule. Do not claim the new
layout is already implemented in status docs before it is delivered.

Code/test entry points verified during brief preparation:

- `web/src/ui/app-shell.ts`: context menus, header values/options, action
  callbacks, feature search, and representation/parcellation controls.
- `web/src/ui/data-chooser.ts`: current phone-only staged chooser.
- `web/src/ui/context-menu.ts`: shared searchable/grouped menu and keyboard
  behavior; reuse or extend rather than duplicate accessibility logic.
- `web/src/styles/components/app-header.css`,
  `web/src/styles/layout/responsive.css`, and
  `web/src/styles/layout/app-shell.css`: header and responsive composition.
- `web/src/application/dataset-navigation.ts`: pure edition/custom/local
  resolution and intent-specific transitions; retain this authority.
- `web/src/data/contracts.ts`: catalog groups, ordering, and release metadata.
- `web/test/unit/catalog-navigation.test.js` and
  `web/test/browser/dataset-navigation.spec.ts`: navigation and chooser tests.
- Related browser suites: `app.spec.ts`, `url-history.spec.ts`,
  `keyboard-shortcuts.spec.ts`, `workspace-layout.spec.ts`, `local-import.spec.ts`,
  `volume.spec.ts`, and `help-tour.spec.ts` under `web/test/browser/`.
  Search for other selector, screenshot, help, and real-data references before
  removing current controls.

Baseline at preparation: clean `main` at `8b24fe1` (Clarify project and dataset
selectors), one commit ahead of fetched origin/main. That existing commit is
preserved and included in the preparation push. Re-inspect git state on pickup.

## Subagent plan

The intended lead is **GPT-6 Astra / low**. It owns implementation, integration,
verification, and git operations. Explicit owner authorization permits different
subagent models and reasoning efforts; use the supported spawn parameters,
not merely a model name written in a prompt.

| Bounded task | Starting model | Effort | Deliverable |
| --- | --- | --- | --- |
| Map existing controls, state dependencies, selectors, and relevant tests | `gpt-5.6-luna` | `medium` | Read-only file map and regression checklist |
| Independently review the implemented diff for navigation, accessibility, and regressions | `gpt-5.6-sol` | `high` | Prioritized findings with locations and validation gaps |

- Run the mapping agent alongside the lead's independent design/code inspection;
  run the reviewer alongside useful remaining validation or documentation work.
  Do not delegate reading or interpreting skills that the lead must read itself.
- Use limited/no history forks when model/effort overrides require them. Pass
  the repo path, this brief, scope, invariants, and exact expected output.
- Keep the tightly coupled header implementation with the lead. Default these
  subagents to read-only work to avoid overlapping edits on shared `main`.
- These choices are starting points, not benchmark claims. The owner authorizes
  adjusting model/effort to task complexity, including Astra high for a difficult
  unresolved review. If a model is unavailable, report the substitution and use
  an available suitable model. Never claim an agent ran when it did not.
- Respect runtime concurrency limits (currently four agents including the lead).
  Do not create agents merely to fill slots or split trivial work.

## Implementation and commit sequence

1. Inspect/fetch `main`, preserve unrelated changes, read authority, and establish
   the `just check` baseline. Investigate existing failures before product work.
2. Implement a coherent Data/release selection slice with semantic tests and
   the presentation decision/documentation update. Validate and commit.
3. Complete feature emphasis, view placement, responsive layout, accessibility,
   and affected help/test updates. Validate and commit. Adjust these boundaries
   if separation would leave a broken or misleading intermediate UI.
4. Obtain the independent review; fix actionable findings, inspect real browser
   output, and run final checks. Commit any coherent remaining fixes and update
   this record plus integration/plan docs to actual completed state.
5. Confirm intended diff, clean worktree, and passing `just check`. Fetch origin
   again; integrate remote changes only safely from clean state and revalidate
   any resulting integration. Push `main` normally and verify remote SHA equals
   local HEAD. Report commits, validation, visual evidence, and push status.

Run targeted checks while developing and `just check` before each completion
checkpoint; never intentionally hand off a red commit. Do not stop after merely
proposing this sequence. If a real external blocker remains, record exact
evidence and remaining work without claiming completion.

## Acceptance and regression checks

- Data chooser groups real projects distinctly and exposes local inventory
  correctly; selecting a dataset resolves one exact history checkpoint.
- Edition dataset switches retain the mapped release. Individual overrides
  remain visibly custom, retain any baseline, and never silently re-enter an
  edition; explicit edition selection restores it.
- Refresh, direct links, and Back/Forward preserve exact context, feature,
  parcellation, representation, cursor, and relevant workspace state.
- Feature search and shortcuts still work. Catalog loading, invalid identities,
  missing local data, and release errors retain existing recovery behavior and
  do not display a false coordinated claim while loading.
- Menus have accessible names and groups, predictable keyboard traversal,
  Escape/focus restoration, and loading/error announcements. Opening one control
  does not leave overlapping menus. Version details work with keyboard and touch.
- Inspect representative desktop, tablet, 390 px phone, and breakpoint-edge
  layouts in a real browser. No horizontal page overflow or clipped popovers;
  long labels remain understandable, and resizing does not change selection.
- Update Playwright semantic coverage for new controls and preserved navigation;
  extend deterministic unit coverage only if transition logic changes. Mount
  canonical synthetic fixtures through the test-only server, never public copies.
- Run `just check`. Linux owns canonical screenshot baselines: do not regenerate
  them on macOS or weaken pixel gates to hide intentional layout differences.
  If Linux evidence cannot be obtained, disclose that limitation explicitly.

## Progress record

- Preparation completed: repository/code inspection and the executable handoff brief.
- Preparation validation: `just check` passed on macOS on 2026-09-05;
  424 builder tests passed (1 skipped), 30 publishing tests passed, web
  typecheck/unit/build checks passed, and 120 browser tests passed. Screenshot
  manifest check passed; 4 canonical Linux screenshot cases skipped as intended
  on macOS. No product code or screenshot baselines changed in this brief task.
- Implementation now delivered below; this preparation record is retained as baseline evidence.
- Risks: conflating an edition with one dataset's release; losing custom/local
  disclosure; treating representation/parcellation as orientation; stale help
  selectors or Linux screenshots; overlapping shared-worktree edits.
- Scientific blockers Q2/Q5/Q8/Q9 remain unchanged and do not block this UI task.
- Preparation commit: locate with
  `git log -1 --format='%h %s' -- docs/tasks/2026-09-05-top-bar-redesign/README.md`.
  Future implementation agent: append milestone commit IDs and actual validation
  evidence here as work lands.
- Current next action: finish the final Linux gate, commit the redesign, and push `main` normally.

### Implementation baseline — Linux, 2026-09-05

- Fetched `origin/main` at `e3e032e`; git preflight passed and worktree was clean.
- Initial `just check`: 424 builder tests (1 skipped), 30 publishing tests,
  web checks and 120 browser tests passed. The desktop documentation screenshot
  alone differed (5,141 pixels), confined to the header changed before pickup.
- Inspected the diff and regenerated that screenshot on Linux. Full `just check`
  then passed, including all four canonical screenshot cases.
- Next: grouped Data/Release controls, feature/display composition, regression
  coverage, independent review, final validation and normal push.

### Redesign implementation — Linux, 2026-09-05

- Baseline commit: `38ede12` (green Linux screenshot refresh).
- Replaced separate/staged selectors with one catalog-ordered Data chooser and
  a Release menu grouping coordinated editions and exact versions. Data retains
  the active baseline; reselecting the current dataset is a no-op. Explicit
  release choices remain custom until explicit edition re-entry.
- Feature has a dedicated prominent search control. Display & parcellation is
  above the retained visualization, including while maximized. Narrow layouts
  use two header rows and preserve the IBL brand, local identity, and readable
  custom-baseline disclosure. Shared menus are opaque, viewport-bounded, and
  restore focus on Escape and resize.
- D063 refines D056/D061 presentation only. Updated navigation/launch/status/help
  documents, semantic tests, real-release suites, local validation scripts, and
  intentional Linux screenshot changes. The tightly coupled header, workspace,
  and selector migration form one coherent implementation commit rather than
  a misleading partial navigation milestone.
- Luna / medium completed the read-only control/selector map. Sol / high delivered
  findings about opt-in validation selectors and resize focus; all were fixed
  and tested. The review service then reported an exhausted credit balance before
  its final report. The lead completed the remaining diff and browser review;
  no completed independent final sign-off is claimed.
- Targeted evidence: 60 initial UI/navigation/local-import checks passed; final
  navigation coverage has 14 cases, including cross-project and custom-baseline
  transitions at desktop/tablet/phone sizes, exact refresh/history, same-dataset
  no-op, recovery, menu occlusion, loading, and keyboard behavior.
- Real-data evidence: `just validate-local-full http://localhost:5174/
  ../artifacts/top-bar-redesign` visited all four reviewed local releases and
  Summary/Top/Swanson/3-D without browser errors or repeated geometry uploads.
  Channel (5), cluster (3), and Brain-Wide Map (3) acceptance tests passed.
- Browser inspection: synthetic and real desktop/tablet/390 px phone plus
  759/760 and 1099/1100 breakpoint edges. Ignored reproducible captures and
  `evidence.json` are in `artifacts/top-bar-redesign/`; canonical documentation
  screenshots are updated under `docs/assets/generated/` on Linux.
- Q2/Q5/Q8/Q9 and all scientific/catalog/deployment choices are unchanged. Native
  Safari validation was not run on this Linux host; its selectors were migrated.

### Final implementation gate

`just check` passed on Linux: 424 builder tests (1 skipped), 30 publishing tests,
314 web unit tests, 21 rendering tests, typecheck/build/docs gates, 128 browser
tests, and all four canonical documentation screenshot comparisons. No test or
pixel tolerance was weakened. The earlier transient screenshot capture failure
was absent in the final full run. Final diff whitespace checks pass.

The implementation is ready for its green commit and normal `main` push.
