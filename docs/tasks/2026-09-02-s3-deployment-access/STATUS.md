# Status

- State: access evidence documented; deployment blocked on Q8 choices.
- Recorded: 2026-09-02 on `main`.
- Confirmed: temporary CLI authentication, private prefix listing, object
  metadata reads, and non-mutating conditional `PutObject` authorization.
- Mutations: none; the probed object's size, ETag, and modification time were
  unchanged after the rejected conditional write.
- Durable runbook: [`../../publishing/S3_DEPLOYMENT.md`](../../publishing/S3_DEPLOYMENT.md).
- Plan: preserve the confirmed access facts, keep credentials out of Git, and
  stop before upload until Q8 selects the destination root and delivery
  topology.
- Unrelated worktree changes: existing frontend edits were preserved and are
  outside this task.
- Validation: `just docs-check docs-site` passes. `just check` reached the
  Python suite, where 397 tests passed and 1 was skipped before an unrelated
  unstaged frontend architecture violation failed
  `tests/test_web_architecture.py`; `domain/types.ts` currently imports
  `application/colormap-palettes.js` in the pre-existing worktree edits.
- Commits: documentation commit; find it with
  `git log -1 -- docs/publishing/S3_DEPLOYMENT.md`.
