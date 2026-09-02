# Next steps

Repository-owner or deployment-owner answers are required before upload:

1. Select direct validated AWS CLI publication versus an S3 publishing
   adapter/control plane.
2. Identify how `ephys-atlas.iblcore.org` is hosted and how browser requests
   reach the private S3 data; provide the intended data hostname or URL path.
3. Decide whether to use CloudFront or explicitly revise D040 with another
   controlled HTTPS delivery boundary.
4. Provision DNS/TLS and approve MIME, CORS, Range, immutable-cache, and
   mutable-index cache rules.
5. Identify the first already-built immutable artifact set authorized for
   staging; Q2, Q5, and Q9 still constrain production/paper claims.
6. Run the runbook preflight, validate local bytes, upload without overwrite or
   delete, and record origin-level integrity and browser evidence.
