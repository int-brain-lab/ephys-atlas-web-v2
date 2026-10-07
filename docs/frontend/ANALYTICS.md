# Conservative usage analytics

Status: active implementation contract and deployment verification runbook.
Authority: D083 in [Decisions](../DECISIONS.md#d083--conservative-umami-analytics).

The site uses Umami Cloud website `e0c4d44e-c85c-4f15-abbb-32091b6b8a7c`.
The website ID is public configuration, not a credential. Tracking runs only
in a production build on `https://ephys-atlas.iblcore.org`, at `/`, `/app`
or `/app/`. Development, preview hosts and lab routes do not load the tracker.

## Counting contract

Each document attempts one pageview, normalized to `/` or `/app/`. The viewer can
also send these six events, each at most once per document:

| Event | Trigger |
| --- | --- |
| `data_loaded` | First current feature payload matching dataset, immutable release, feature, representation and regional parcellation, without a current data error. Volume index/summary availability does not prove slice rendering. |
| `exploration_started` | An accepted user action changes dataset/release/feature/representation or adds a selected region. Automatic defaults, URL hydration, reconciliation, retry, slice movement and selection removal are excluded. |
| `comparison_used` | Open regional comparison with at least two rendered region rows. Hidden comparisons and volume anatomy-only messages do not qualify. |
| `share_copied` | Clipboard write succeeds, including the existing local-data disclosure flow. The shared URL is not sent. |
| `download_started` | Prepared Blob link is clicked, covering feature CSV, comparison, volume distribution and verified artifacts. Browser save completion cannot be observed. |
| `local_imported` | Validated archive admission to IndexedDB succeeds, regardless of later catalog refresh/navigation. |

Maximum: seven events for a viewer document, eight including a preceding
landing document. Reloads and new tabs count again. BFCache restoration retains
the same document limits. These are document-level capability counts, not
identified users, unique visitors or Umami sessions. Slice-only exploration
does not trigger `exploration_started`; absence of that event is not proof of
no engagement. Custom events can also affect Umami bounce/duration metrics.

## Transport and metadata

`web/src/analytics.ts` owns the singleton, explicit payload construction,
script loading and once-event deduplication. `site.ts` initializes it before
waiting for viewer startup. The script uses `data-auto-track="false"`, with
no automatic pageviews, history/click tracking or performance collection.

Every explicit payload contains the website ID, production hostname, screen
size, browser language, fixed route/title and sanitized entry referrer.
External referrers retain only their HTTP(S) origin; same-site referrers retain
only recognized landing/viewer routes. No `data` properties, identifiers,
query/hash state, full private paths, filenames, feature names or errors are
sent. Campaign parameters are deliberately omitted initially.

The queue holds at most the pageview and six unique events. Events are marked
at admission, so rapid interactions cannot create duplicates while the script
loads. A finite load deadline discards queued events if the script fails or is
blocked. Sends are bounded, sequential and best-effort, without retries or
persistent storage. Failures never block application work. Tracker opt-outs
and Do Not Track are respected.

Current Umami Cloud delivery uses `https://cloud.umami.is/script.js` and
`https://gateway.umami.is/api/send`. Any future Content Security Policy must
allow the script and delivery separately. No site CSP change is needed in the
current implementation.

## Verification and deployment

Deterministic analytics unit tests verify the production gate, exact safe
payloads, bounded queue, ordering, deduplication and script/send failures.
Browser action tests intercept the analytics module and use the canonical
golden fixture through the test-only local-release server; they never send
synthetic usage to the production analytics website. Run `just check` before
deployment.

After an authorized site deployment, make one controlled visit to the landing
and viewer with tracker opt-out disabled. In browser Network tools verify the
script loads, pageviews have only the normalized route and safe metadata,
and deliberate actions send only the declared events. Moving slices, changing
query/hash state and repeating actions must not add sends. Check receipt in
the Umami dashboard, then exclude routine maintainer visits using
`localStorage.setItem('umami.disabled', '1')` on the production origin.

Umami's [tracker configuration](https://docs.umami.is/docs/tracker-configuration)
and [tracker functions](https://docs.umami.is/docs/tracker-functions) define the
external API. The [Cloud pricing](https://umami.is/pricing) currently lists
100,000 monthly events and six months' retention for Hobby; each custom data
property also consumes quota. This implementation sends no custom properties.
