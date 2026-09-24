# Site UI deployment — 2026-09-24

Status: complete. The merged channel-variant labels, volume anatomy-colour
toggle/peek, and region tooltip details are live at
<https://ephys-atlas.iblcore.org>.

## Published build

| Item | Value |
| --- | --- |
| Source commit | `433f6be9fd02914c34d41511ebb4568c6ec0fe8e` |
| Site build | `dd84910e44def90bea41660bc7e554e2` |
| Immutable site prefix | `site/builds/dd84910e44def90bea41660bc7e554e2/` |
| Site transaction | `9d2b33f99d405d47552fbf7cbacc2a1d5c1eb12bebcf85a166594927f2487c51` |
| S3 environment | `aggregates/atlas/ephys-atlas-web-v2/production/` |
| Files in build | 19 |

The Linux build used Node `v22.17.1`, Python `3.12.3`, and NumPy `2.5.2`.
The site publisher revalidated the pinned catalog and projection/mesh manifests
against production before publishing. Its receipt reports
`catalog_changed: false`; no scientific release, catalog, pack, CloudFront
configuration, DNS, or v1 objects were changed.

## Live checks

- `GET /` and `GET /app/` both returned HTTP 200, 7,889 bytes, with
  `Cache-Control: no-cache`.
- The immutable build entry returned HTTP 200, 7,828 bytes, SHA-256
  `9adc069c47c2901fcd767a293fc981b5ea5636c1f062c6186554c28a1fb42056`, and
  one-year immutable caching.
- The main JavaScript asset returned HTTP 200, 364,728 bytes, SHA-256
  `3b8da53da1f336b359e482c725e568e90fdb2242a65ba48bfd61f1e737ec7b17`, and
  one-year immutable caching.
- Chromium loaded `/` and `/app/` with no page errors or HTTP error responses.
- The live W26 volume view rendered the three composite viewports. The
  **Anatomy colours** control was visible; enabling it set `anatomy=1` in the
  URL and activated the anatomy-colour presentation on the composite views.

Raw HTTP headers and response bodies, plus the immutable build receipt, are
retained locally under ignored `artifacts/deployment-ui-433f6be/`. The CI run
for the source commit passed Python, web, and browser jobs before publication.
