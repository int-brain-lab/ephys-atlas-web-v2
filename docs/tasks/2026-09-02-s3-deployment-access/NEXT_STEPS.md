# Next steps

Repository-owner or deployment-owner answers are required before upload:

1. Approve `ibl-brain-wide-map-private` as staging, production, or neither.
2. Name a distinct deployment root below the bucket; do not reuse the existing
   `aggregates/atlas/` source namespace directly.
3. Select direct S3 publication versus a publishing adapter/control plane.
4. Provide or provision the CloudFront distribution and public data domain.
5. Approve MIME, CORS, Range, immutable-cache, and mutable-index cache rules.
6. Identify the first already-built immutable artifact set authorized for
   staging; Q2, Q5, and Q9 still constrain production/paper claims.
7. Run the runbook preflight, validate local bytes, upload without overwrite or
   delete, and record origin-level integrity and browser evidence.

