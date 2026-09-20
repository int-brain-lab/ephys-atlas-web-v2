# Registered atlas asset provenance

Status: validated-real-local candidate for shared publication. This record does
not authorize publication, change the browser runtime, or make the ignored
`web/dist` directory a source tree artifact.

The exact immutable graph currently used by the website is
`ibl-atlas-projections-05b9f3f85db9` (the tracked deployment descriptor records
its manifest size and SHA-256). It is the bilateral Allen CCFv3
10 µm parent anatomy pack, its sparse 80 µm display derivative, and the
registered projection pack. Machine-readable identities, source hashes,
builder commits, terms, and citation are in
[`REGISTERED_ATLAS_ASSET_PROVENANCE.json`](REGISTERED_ATLAS_ASSET_PROVENANCE.json).

The parent source objects are the Allen CCFv3 10 µm annotation and bilateral
region LUT. Their local byte identities are recorded in the JSON entry; the
Allen terms page and Wang et al. (2020) citation are recorded there as the
source notice. `iblatlas` supplies the signed Allen/Beryl/Cosmos presentation
and is pinned to the recorded commit. The generated parent carries exact
topology, coverage, sentinel, and zero-boundary-error validation evidence.

The historical Top and Swanson fragments remain separately covered by the
existing MIT notice at
`web/dist/atlas/projections/ibl-static-registered-v1/LICENSES/IBL-EPHYS-ATLAS-V1-STATIC-ASSETS-MIT.txt`.
That notice does not license the Allen-derived parent annotation or LUT.

## Validation and publication gate

Run the targeted inventory test:

```bash
uv run --project builder --extra test --locked \
  python -m pytest tests/test_registered_atlas_asset_provenance.py -q
```

This checks the tracked deployment descriptor, its immutable graph identity,
and the locally available parent manifest/source evidence. It is evidence, not
a publication operation.

The existing publisher deliberately requires a clean Linux `main`, current
builder provenance, and an exact current-head pack build. The checked-in local
graph was built by historical commits and therefore must not be passed to
`tools.s3_assets --apply` as if it were a current release. After publication
authority is granted, rebuild or repackage through the approved Linux builder,
record the new immutable pack IDs and hashes in this entry, then run the exact
offline plan first:

```bash
uv run --project builder --extra test --locked \
  python -m tools.s3_assets projection <new-pack-directory> \
  --environment production
```

Only after the offline plan, source approval, and remote destination are
confirmed may the operator append:

```text
--apply --profile ibl-atlas \
  --confirm-root aggregates/atlas/ephys-atlas-web-v2/production/
```

No AWS mutation is part of this repository change. Runtime URLs/defaults remain
unchanged until remote immutable bytes, served-byte/SHA validation, CORS,
opaque-gzip delivery, and browser parity have all passed.

The live CloudFront response for the deployed projection manifest currently
serves immutable cache headers but does not return
`Access-Control-Allow-Origin` for an external `Origin` request. This is a
delivery follow-up, not a missing scientific-artifact field: fix it in the
approved CloudFront/origin configuration, then capture a read-only response
check for the exact deployed path before any shared-lock consumer is enabled.
Do not use `tools.s3_assets --apply` for this; the graph is already immutable
and must not be duplicated or mutated.
