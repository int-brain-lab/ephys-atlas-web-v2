# Status

- State: D059 records the bucket, environment roots, immutable-key policy, and
  planned initial viewer domain; deployment remains blocked on residual Q8.
- Recorded: 2026-09-02 on `main`.
- Confirmed: temporary CLI authentication, private prefix listing, object
  metadata reads, and non-mutating conditional `PutObject` authorization.
- Approved: one private bucket for both environments, with exact isolated
  `ephys-atlas-web-v2/staging/` and `ephys-atlas-web-v2/production/` roots below
  `aggregates/atlas/`; immutable release keys must resist overwrite.
- Planned domain: `ephys-atlas.iblcore.org`; DNS did not yet resolve from the
  repository host on 2026-09-02.
- Mutations: none; the probed object's size, ETag, and modification time were
  unchanged after the rejected conditional write.
- Durable runbook: [`../../publishing/S3_DEPLOYMENT.md`](../../publishing/S3_DEPLOYMENT.md).
- Plan: preserve the confirmed access facts, keep credentials out of Git, and
  stop before upload until Q8 selects the public delivery and publication
  procedure and an exact staging artifact set is authorized.
- Unrelated worktree changes: existing frontend edits were preserved and are
  outside this task.
- Validation: `just docs-check docs-site` passes. `just check` reached the
  Python suite, where 397 tests passed and 1 was skipped before an unrelated
  unstaged frontend architecture violation failed
  `tests/test_web_architecture.py`; `domain/types.ts` currently imports
  `application/colormap-palettes.js` in the pre-existing worktree edits.
- Commits: documentation commit; find it with
  `git log -1 -- docs/publishing/S3_DEPLOYMENT.md`.
