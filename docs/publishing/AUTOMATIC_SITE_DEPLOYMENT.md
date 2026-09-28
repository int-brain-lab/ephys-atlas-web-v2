# Automatic production site deployment

Status: GitHub environment and workflow prepared; AWS OIDC role pending.

The `deploy_site` job in [CI](../../.github/workflows/ci.yml) publishes only the
compiled viewer. It runs after the Python and web jobs succeed on the current
`main` commit. The job is skipped until the repository variable
`PRODUCTION_AWS_ROLE_ARN` names a working role. A manual CI run on `main` can
exercise the same path after activation. The GitHub `production` environment
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

## AWS administrator setup

The production AWS account is `842577843587`. `iblmember` cannot list IAM
roles or OIDC providers, so an IAM administrator must check whether the GitHub
provider `https://token.actions.githubusercontent.com` exists. If absent,
create it with audience `sts.amazonaws.com`. Create a role, for example
`ephys-atlas-web-v2-site-deploy`, with the exact
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
restrictions before activation.

After the role exists, set the repository Actions variable
`PRODUCTION_AWS_ROLE_ARN` to its ARN. This is an identifier, not a secret.
Then run CI once manually on `main` and verify its deployment job and live
site. Later successful `main` pushes use the same path. Keep the existing
site-only rollback procedure in [Local publisher operations](LOCAL_PUBLISHER.md);
do not delete older immutable site builds.

This role is separate from the CloudFront response-headers permissions
requested for `iblmember`. Site and data currently share one origin; the
automatic site publisher does not create or update a CORS policy.
