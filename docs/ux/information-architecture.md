# UX information architecture

## IA-001 — Workspace hierarchy

Status: accepted

The default desktop experience uses a single scientific workspace with a strong visual hierarchy.

- Coronal, sagittal, and horizontal slices are the primary views and dominate the default workspace.
- Top, Swanson, and 3D are secondary views. They remain readily accessible but are not all permanently visible at the same time.
- All views share one scientific state: dataset/release, feature, mapping/statistic, color encoding, coordinates, hovered region, and selected regions.
- Region exploration and descriptive comparison remain tightly coupled to the primary slice workspace.
- Comparison may expand into a larger analysis workspace without becoming a separate application.
- Volume representations should reuse the same overall shell and state model where practical.

Rationale: preserve anatomical context and fast linked exploration without shrinking six views into competing thumbnails. This also matches the launch-critical vertical slice: regional feature -> linked slices -> region selection -> histogram/comparison.

## IA-002 — Dataset, release, and feature hierarchy

Status: accepted

Dataset and feature are primary exploration controls. Release/version is secondary context rather than a permanently prominent peer control.

- The currently selected dataset is always identifiable.
- Feature selection is optimized for frequent switching.
- The resolved immutable release/version is visible but visually subdued in normal exploration.
- A user can explicitly change release/version from dataset details or an adjacent secondary control.
- Paper-facing defaults should resolve to an immutable publication snapshot; aliases such as `latest` may be shown as aliases while still exposing the resolved immutable release.

Rationale: users commonly switch features, sometimes switch datasets, and rarely switch releases. The visual hierarchy should reflect that frequency without hiding provenance.
