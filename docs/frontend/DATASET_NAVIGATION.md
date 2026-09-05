# Dataset navigation and project editions

Status: implemented generic contract; real paper-facing configuration remains blocked on Q9.

D056 establishes the Project, Dataset, Release, Feature, and View hierarchy.
D061 fixes catalog authority, immutable edition identity, explicit browser
context and resolution order. D063 refines the responsive presentation. Exact paper-facing IDs,
labels, release mappings, aliases, and defaults remain governed by Q9.

## Information hierarchy

The public viewer uses this hierarchy:

```text
project
    -> dataset
        -> immutable release
            -> feature
                -> representation
```

- A **project** is a durable scientific grouping such as Ephys Atlas or
  Brain-Wide Map. It is broader and longer-lived than one paper.
- A **dataset** is one population, modality, or result family within a project.
- A **release** is one exact immutable version of a dataset. A friendly label
  never replaces its release ID.
- A **feature** is a release-declared measured quantity.
- A **representation** is a release-declared exploration form such as regional
  summaries or a scalar volume. The **Display & parcellation** control groups
  representation and applicable parcellation choices above the visualization.

The initial public grouping remains:

```text
Ephys Atlas
    Channel features
    Cluster features
    Encoding volumes

Brain-Wide Map
    Preserved legacy website results

My data
    Browser-local imported releases
```

`My data` is a browser UI section, not a public project or publication claim.
The public schema catalog and local inventory remain distinct types. The
browser composes them into one navigation model with an explicit public/local
source discriminant. The public identity `local` is reserved and rejected so
it cannot be misrouted into IndexedDB.

## Project editions and immutable identity

A **project edition** is a named, coordinated mapping from an explicit scoped
set of project datasets to exact immutable release IDs. Every dataset in the
edition scope appears exactly once. The scope need not equal the project's
future dataset membership: adding a dataset to a project must not invalidate a
historical edition.

The identity `(project_id, edition_id)` is immutable after exposure. A later
catalog may retain or omit that edition, but must never reuse its ID for a
different dataset/release mapping. The catalog promotion path rejects any such
remapping. A paper-facing edition is therefore reproducible even though the
catalog that discovers it is mutable.

Q9 retains the approved scope and exact release mapping of the real paper
edition. It may require that edition to cover the complete separately approved
paper release set without imposing equality with all future project datasets.

## Explicit navigation context

Browser state uses a discriminated context rather than inferring an edition
claim from matching releases:

```text
edition(project_id, edition_id)
custom(project_id, base_edition_id?)
local
```

- Switching datasets in coordinated edition context selects the release mapped
  by that edition.
- Explicitly choosing another release enters custom context. If the user came
  from an edition, retain it as an optional baseline and disclose
  `Individual releases · based on <edition>`.
- Switching datasets in custom context uses the baseline mapping where that
  dataset is in scope; selecting a dataset outside the scope uses its exact
  catalog default and remains custom.
- Choosing a release that happens to match an edition mapping never silently
  re-enters that edition. Only explicit edition selection restores the
  coordinated claim.
- Local context never acquires public project or edition meaning.

Use intent-specific transitions for project selection, edition selection,
edition-aware dataset switching, explicit release override, and local
selection. A generic dataset setter must not erase the difference between
these scientific-context changes.

## Catalog contract

Extend the existing schema-v1 `catalog.json`; do not add a side table, a
frontend grouping map, or a compatibility catalog shape. The intended semantic
shape is:

```text
catalog
  schema_version
  default_project
  projects[]
    project_id, title, description?
    dataset_ids[]
    default_dataset
    default_edition?
    editions[]
      edition_id, label, description?
      dataset_releases[]
        dataset_id, release_id
  datasets[]
    dataset_id, title, description?
    default_release
    releases[]
      release_id, label, status? (`legacy | development`), description?, manifest
```

Arrays define canonical presentation order. Semantic validation requires:

- unique project IDs, dataset IDs, edition IDs within a project, and release
  IDs within a dataset;
- every public dataset belongs to exactly one project;
- every ordered project dataset reference exists;
- `default_project`, each `default_dataset`, every optional `default_edition`,
  and every dataset `default_release` resolve exactly;
- each edition pair belongs to its project and references an existing exact
  release, with no repeated dataset in one edition;
- an already exposed edition identity cannot be remapped;
- the reserved local source identity cannot be published;
- every release has a required presentation label distinct from its immutable
  identity;
- durable release status, when present, is exactly the initial structured enum
  `legacy | development`; absence means no durable status.

`Recommended` is derived from the active edition/default context and `Local`
from the source discriminant. Neither is stored as durable release status.
Dataset aliases remain administrative inputs to exact release selection.
Curator-owned edition aliases resolve to exact edition IDs before public
catalog emission. Neither symbolic form enters browser state or share URLs.

## Catalog authority and promotion

Project membership, ordering, release presentation, edition mappings, and
defaults are governed by a repository-versioned curator configuration. They
span datasets and cannot be mutated by any one dataset publisher. Ordinary
publication makes a validated immutable release available without granting it
public discovery or edition membership.

An explicit curator-owned compile/promote operation combines that configuration
with the published immutable inventory. It validates the complete prospective
cross-dataset graph, preserves all exposed edition identities, and updates the
public catalog last using compare-and-swap or equivalent conditional-write
semantics. Failure leaves the last-known-good catalog visible. The D060 local
S3 publisher and the optional hosted publisher must use the same compiler and
promotion rules rather than independently generating catalogs.

The repository may exercise this path with synthetic curator configuration.
No synthetic name or mapping becomes the production paper default.

## URL and resolution lifecycle

Keep URL version 4 and separate two types:

- `NavigationRequest` represents raw URL, default, or alias intent and may be
  unresolved;
- `ResolvedNavigation` contains exact public project/context/dataset/release
  identity or exact local identity.

Startup loads and validates the catalog before resolving navigation. It then
commits exact resolved state and a canonical URL before loading the release.
Apply the same resolver before every `popstate` hydration. A published dataset
session never receives a null release ID, and the data source never silently
substitutes `default_release` for an explicit or already-resolved request.

URL v4 preserves exact `dataset` and `release` plus exact `project` and
`edition` when coordinated context is active. Custom context is explicit and
may preserve `base_edition`; local context remains explicit. Existing exact
v4 dataset/release links resolve as custom context. A blank URL resolves
catalog-owned `default_project`, per-project `default_dataset`, and optional
`default_edition`, then immediately canonicalizes to exact identities. Alias
entry URLs do the same.

Project, edition, dataset, and explicit release changes create history
checkpoints. Derived feature/parcellation reconciliation and canonicalization
replace the current checkpoint. An invalid explicit identity remains visible
in the error model and never silently adopts a newer alias or default.

## Data, Release, and Feature context bar

D063 uses one presentation at desktop, tablet, and phone widths:

| Control | Primary content | Supporting content |
| --- | --- | --- |
| Data | Project / dataset breadcrumb | Browser-local or recovery disclosure where applicable |
| Release | Friendly release label and durable status | Coordinated edition or `Individual releases · based on <edition>` |
| Feature | Prominent searchable feature label | Release-declared units; descriptions in the menu |

Data groups selectable datasets under clearly labelled catalog-ordered projects.
It does not require a project/edition wizard. Within a project, selection uses
the active coordinated mapping or custom baseline. Selecting an out-of-scope
dataset retains that baseline as custom; crossing projects resolves the target
project's catalog-owned default context and exact release in one checkpoint.
Browser-local inventory and import/manage/delete actions live under **My data**.
Only exact reviewed title/project combinations are shortened; arbitrary publisher
labels remain unchanged.

Release groups the active project's coordinated editions, **Choose releases
individually**, and the active dataset's exact versions. An explicit exact-version
choice enters custom context even if it matches the baseline mapping. Explicit
edition selection restores coordination. Status, descriptions, and exact immutable
IDs are readable without hover; Info provides full provenance. The closed control
keeps edition/custom-baseline disclosure visible during release loading and
exposes invalid navigation as unavailable with explicit recovery actions.

Local preview catalogs preserve Ephys Atlas and Brain-Wide Map grouping and their
coordinated local-preview edition. Local preview/development and preserved legacy
labels come from existing catalog metadata; browser-local identity comes from the
source discriminant. No example label becomes a new release or default.

## Display and parcellation

**Display & parcellation**, above the visualization, groups the release/feature's
regional or volume representation with its applicable anatomical parcellations.
Typical values are `Regional · Allen` and `Volume · Allen anatomy`. The control
stays accessible during maximization. It changes neither slice orientation nor
workspace layout. Internal/schema code retains `representation`, and all
availability remains data-driven, including volume and optional 3-D interactions.

## Responsive interaction and accessibility

At narrow widths Data and Release occupy the first row and Feature the second.
The same chooser and selection model applies everywhere; resizing never changes
scientific context. Long names and custom baselines wrap, and popover descriptions
and immutable IDs remain readable. Phone popovers use a bounded bottom sheet;
wide popovers stay below the header and inside the viewport.

Menus use labelled `role="group"` structures, predictable arrow-key traversal,
Escape dismissal, focus restoration, and live loading/error announcements. Opening
another control closes the previous menu. Browser coverage includes desktop,
tablet, 390 px phone, and both sides of the responsive breakpoints.

## Loading, error, and recovery behavior

Maintain separate catalog, navigation-resolution, and release-load failures:

- catalog fetch or validation failure retains a previously loaded catalog and
  offers Retry; an initial failure is workspace-level;
- unknown project, edition, dataset, or release preserves and names the exact
  request and offers an explicit catalog-default choice;
- edition/release mismatch offers **Return to edition** or **Open exact release
  as custom**;
- missing local data offers local management/import or the explicit public
  default;
- release-load failure retries the same exact release or lets the user choose
  another version.

Do not continue into dataset loading after catalog failure. Do not collapse all
three failure classes into one undifferentiated runtime error.

## Green delivery sequence

### 1. Atomic catalog contract and compiler cutover

Status: implemented.

Update the canonical and bundled catalog schemas, Python and TypeScript
semantic validators, shared valid/invalid corpus, typed browser parser, curator
configuration/compiler/promotion path, publishing tests, Vite synthetic
producer, and public/local repository composition. Enforce immutable edition
identity and last-known-good catalog promotion. Keep the existing flat header
temporarily consuming the new composed model. Do not accept both catalog
shapes. Run `just check` and commit the coherent producer/consumer cutover.

### 2. Resolved navigation and URL v4

Status: implemented.

Add request/resolved types, edition/custom/local context with optional custom
baseline, pure resolution and transition functions, intent-specific actions,
catalog-first startup and popstate, exact URL serialization, local
import/deletion transitions, and separate runtime failures. Cover the resolver
matrix and history behavior with deterministic unit tests. Run `just check` and
commit.

### 3. Desktop/tablet navigation UI

Status: implemented; presentation refined by D063 above.

Implement Project/Dataset/Feature/View, edition/custom secondary disclosure,
friendly version/status/ID details, View terminology, explicit override and
re-entry actions, and recovery controls. Add Playwright coverage for edition
switching, custom override, explicit re-entry, exact URLs, Back/Forward,
loading, and failure. Run `just check` and commit.

### 4. Narrow UX, accessibility, and durable completion

Status: implemented; D063 replaces the staged chooser with direct grouped selection.

Implement the staged Data chooser, accessible grouped menus, keyboard/focus and
live-region behavior, responsive overflow cases, local composition, invalid URL
recovery, and production-style synthetic catalog coverage. Update schema and
publishing documentation plus integration/readiness status. Run `just check`
and commit.

Q9 is the stop condition for configuring real project-edition IDs, labels,
scope, release mappings, defaults, aliases, and the paper freeze procedure; it
does not block any synthetic machinery in these four slices.
