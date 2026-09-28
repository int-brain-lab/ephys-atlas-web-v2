# Automatic production site deployment

Status: active on `main` since 2026-09-28.

The `deploy_site` job in [CI](../../.github/workflows/ci.yml) publishes only the
compiled viewer. It runs after the Python and web jobs succeed on the current
`main` commit. The repository variable `PRODUCTION_AWS_ROLE_ARN` names the
production site role. A manual CI run on `main` exercises the same path. The GitHub `production` environment
accepts deployments from `main` only and has no required reviewer, so routine
successful pushes can deploy automatically.

The job checks out `main`, skips a commit superseded before deployment, builds
the site with the tracked `data/deployment/initial-site.json`, and invokes the
existing offline plan and conditional S3 site transaction. It verifies `/`,
`/app/`, and the immutable build URL on the public origin. CI serializes runs
without cancelling a publication in progress. The site publisher verifies the
pinned catalog and projection/mesh manifests before replacing `site/index.html`.
It neither builds nor promotes dataset releases, packs, or the catalog.
After a separate data or pack promotion changes any pinned dependency, update
the tracked site configuration before the next site deployment; a mismatch
stops publication rather than using unreviewed data.

## AWS identity and access

The production AWS account is `842577843587`. An IAM administrator created the
GitHub provider `https://token.actions.githubusercontent.com` with audience
`sts.amazonaws.com`, and role
`arn:aws:iam::842577843587:role/ephys-atlas-web-v2-site-deploy` with the exact
[trust policy](../../tools/deployment/github-site-oidc-trust.json) and
[S3 permissions](../../tools/deployment/github-site-publisher-policy.json).
The repository was created after GitHub's immutable OIDC-subject cutover;
GitHub reports the exact subject prefix in the trust policy. The environment
suffix is `:environment:production`, and GitHub restricts that environment to
`main`. Do not replace this subject with a wildcard.

The S3 policy can read the public catalog and projection/mesh manifests, and
read/write `site/*` plus the publisher's shared private `_staging/*` transaction
area below the production root. It has no write access to `datasets/*`,
`atlas/*`, or `catalog.json`; no CloudFront, IAM, delete, or bucket-admin
actions are included. The shared `_staging/*` permission follows the existing
publisher layout. Review the policy against any additional bucket-level
restrictions when changing it.

The repository Actions variable `PRODUCTION_AWS_ROLE_ARN` contains that role
ARN. It is an identifier, not a secret. Keep the existing
site-only rollback procedure in [Local publisher operations](LOCAL_PUBLISHER.md);
do not delete older immutable site builds.

## Activation evidence

On 2026-09-28, [manual CI run 36457090354](https://github.com/int-brain-lab/ephys-atlas-web-v2/actions/runs/36457090354)
passed its Python, web, and `deploy_site` jobs for commit
`2ba4c6305fc4e7625d220ea5a343d0e107fca5bb`. The publisher receipt
reported immutable build `1188d240503f2cb3f72e4f6e71f4aff9`, transaction
`eccc4494619aab8a0d7405db6deef186036fd734e84dbea5b3ce86f908b3c219`,
and `catalog_changed: false`. The workflow's live check passed for `/`,
`/app/`, and the immutable build URL. An independent HTTPS check found the same
build reference at both entry routes and HTTP 200 for its immutable index.

This role is separate from the CloudFront response-headers permissions
requested for `iblmember`. Site and data currently share one origin; the
automatic site publisher does not create or update a CORS policy.
