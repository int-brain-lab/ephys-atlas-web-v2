# Dataset navigation and project editions

Status: accepted product and interaction contract; implementation pending.

This document defines how the public viewer distinguishes scientific projects,
datasets, immutable releases, features, and representations. D056 is the
accepting decision. Exact paper-facing edition names and release IDs remain
governed by Q9.

## Information hierarchy

The viewer uses this hierarchy:

```text
project
    -> dataset
        -> immutable release
            -> feature
                -> representation
```

The terms have distinct meanings:

- A **project** is a durable scientific grouping such as Ephys Atlas or
  Brain-Wide Map. It is broader and longer-lived than one paper.
- A **dataset** is one population, modality, or result family within a project,
  such as channel features, cluster features, or encoding volumes.
- A **release** is one exact immutable version of a dataset. Friendly labels
  never replace its release ID.
- A **feature** is a release-declared measured quantity.
- A **representation** is a release-declared way to explore a feature, such as
  regional summaries or a scalar volume.

The initial public grouping is:

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

`My data` is a UI section, not an official scientific project and not a public
catalog publication claim. Local, shared, and published maturity labels remain
distinct.

## Project editions

A **project edition** is a named, coordinated mapping from the datasets in one
project to exact immutable release IDs. A paper-facing edition is frozen and
reproducible. For example, an Ephys Atlas paper edition may map the channel,
cluster, and volume dataset IDs to three separately immutable releases.

Keeping editions separate from dataset releases prevents two errors:

1. treating one dataset release as if it represented the complete paper; and
2. silently mixing individually valid releases that were not selected as one
   coordinated publication set.

When a user changes datasets within a project edition, the viewer selects the
release named by that edition. If the user explicitly chooses another release,
the viewer leaves the coordinated edition context and labels the result as a
custom version or as outside the named edition. It must not continue implying
that the mixed context is the paper edition.

Mutable aliases or defaults may resolve to an edition or dataset release, but
they remain outside immutable release directories. Selection resolves to exact
release IDs before data loading and URL commitment. Share URLs, exports, and
downloads retain the exact dataset and release identity; edition context is
also preserved when it affects subsequent dataset switching. Opening an old
share must not silently adopt a newer alias target.

Q9 retains the exact public edition ID and label, release mapping, default,
alias names, and freeze process. D056 does not supply those unresolved values.

## Desktop context bar

The primary desktop order is:

| Control | Example | Meaning |
| --- | --- | --- |
| Project | Ephys Atlas | Select a distinct scientific work |
| Dataset | Channel features | Select a population, modality, or result family |
| Feature | Spike amplitude | Select a release-declared quantity |
| View | Regional · Allen | Select representation and applicable parcellation |

Release selection is attached to the Dataset control rather than occupying an
equally prominent fifth field. The closed Dataset field shows its friendly
release label on the secondary line. Its menu groups releases beneath each
dataset and shows:

- a concise user-facing label such as `Paper release` or `2026 W32`;
- a status where applicable, such as `Recommended`, `Legacy snapshot`,
  `Local`, or `Development`;
- the exact immutable release ID as secondary technical information; and
- enough provenance or description to distinguish scientifically different
  choices.

Release IDs are never replaced by friendly labels in provenance, URLs, or
downloads. `Latest` is an alias or selection affordance, not an immutable
release label.

## View terminology

The user-facing label is **View**, not **Representation**. Typical values are:

- `Regional · Allen`;
- `Regional · Beryl`;
- `Regional · Cosmos`; and
- `Volume · Allen anatomy`.

The internal and schema term remains `representation`. Representation and
parcellation availability continue to come from the selected release and
feature. The UI must not manufacture choices or hardcode a complete feature
catalog. If only one representation is available, View may primarily expose
the applicable parcellation rather than presenting a meaningless choice.

## Catalog and URL requirements

The public catalog must eventually describe project membership, ordering,
friendly release presentation, project editions, and their exact dataset to
release mappings. These are public discovery/navigation metadata; they do not
replace dataset manifests, immutable provenance, or the existing open runtime
dataset identity.

The implementation must update the schema-v1 catalog producer, Python and
TypeScript validators, publishing catalog generation, HTTP/local composition,
fixtures, URL state, UI, and tests as one coherent contract change. Do not add
a frontend-only grouping table or an adapter-specific shadow catalog.

Project and edition changes are explicit scientific-context checkpoints under
D029. URL state must preserve enough information to reconstruct the selected
project edition or disclosed custom-version context while retaining the exact
active dataset and release.

## Responsive behavior

Desktop should keep the four scientific controls visible. Narrow layouts may
collapse Project and Dataset into a compact breadcrumb or staged chooser, but
must keep the active project, dataset, and version discoverable and
keyboard-reversible. Responsive composition must not erase edition/custom
version disclosure or change the selected immutable release.
