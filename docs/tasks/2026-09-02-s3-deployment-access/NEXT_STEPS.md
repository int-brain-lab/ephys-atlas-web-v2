# Next steps

Repository-owner or deployment-owner answers are required before upload:

1. Implement the D060 local S3 publisher with validation, resumable private
   staging, create-only immutable keys, remote verification, and catalog-last
   publication.
2. Provision isolated staging and production CloudFront distributions with
   S3 Origin Access Control scoped to the exact D059 roots.
3. Configure `ephys-atlas.iblcore.org`, ACM/TLS, and the `site/` Vite build
   path; select an isolated staging hostname.
4. Approve MIME, CORS, Range, immutable-cache, entry-document, and
   mutable-index cache rules plus the minimum publisher IAM policy.
5. Identify the first already-built immutable artifact set authorized for
   staging; Q2, Q5, and Q9 still constrain production/paper claims.
6. Run the runbook preflight, validate local bytes, upload without overwrite or
   delete, and record origin-level integrity and browser evidence.
