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
