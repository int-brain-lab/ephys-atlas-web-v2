# Local-import capacity and resilience evidence

Status: frozen evidence recorded 2026-08-31.

This record closes the 2026-08-30/31 engineering campaign for bounded browser
ZIP preview and IndexedDB admission. It supports the local-data implementation;
it does not select a production dataset, deploy an origin, authorize PyPI
publication, or resolve Q2, Q5, Q8, or Q9.

The measured values below are evidence for the exact archives, browsers, host,
and revisions recorded here. The limits remain safety ceilings, not a promise
that every launch browser can admit every archive at every ceiling.

## Method

The deterministic generator under `benchmarks/local_import/` produced:

- exact schema-v1 bundles from the reviewed local channel and volume releases;
- valid synthetic cases at the archive-byte and entry-count ceilings; and
- compact malformed archives whose central-directory metadata reaches a
  specific rejection path without allocating the declared payload.

`tests/test_local_import_benchmark.py` verifies corpus determinism, source
release identity, exact hashes, schema validity for accepted bundles, exact
20,000-entry construction, and compact adversarial metadata. The opt-in
single-worker browser harness in `web/test/local-import-benchmark/` verifies an
archive's recorded size and SHA-256 before use, starts with an empty local
database, and records preview, admission, reload, deep verification, deletion,
storage estimates, and final IndexedDB counts. Invalid cases must leave zero
manifests and zero resources.

The Linux host was kernel `7.0.0-28-generic`, x86-64, an Intel Core i9-14900K
with 32 logical CPUs and 134,698,684,416 bytes of RAM. Browser binaries were
Chromium/Chrome for Testing `151.0.7922.34`, Playwright Firefox `153.0`, and
Playwright WebKit `26.5`. WebKit here is the Playwright Linux port, not Safari.

Native Safari was exercised separately through `safaridriver` on a MacBook Air
M4: Safari `26.5` (`21624.2.5.11.4`), macOS `26.5.1` build `25F80`. The viewer
was reached through localhost, preserving the secure context required by
WebCrypto. `web/scripts/native-safari-local-import.py` records native Safari
capabilities and keeps this evidence distinct from Playwright WebKit.

Ignored raw corpora and JSON results remain under
`artifacts/local-import-benchmark/`; native Safari JSON and screenshots remain
under `artifacts/native-safari/`. They are reproducible evidence inputs, not
scientific releases or tracked runtime defaults.

## Exact accepted corpus

| Case | Kind | ZIP bytes | Entries | ZIP-expanded bytes | SHA-256 |
| --- | --- | ---: | ---: | ---: | --- |
| `smoke` | synthetic | 1,061,531 | 32 | 1,081,080 | `b25b80f18687603bc96458d127434addf645d7e7973208346651cd7bbd241b65` |
| `channels-q14` | exact real regional release | 8,733,904 | 1,136 | 34,500,520 | `bd7ab813c0b2ae08f86258e9bd58083950afe1313dd88e511341e9db3fef4c5f` |
| `volumes-depth4-q14` | exact real volume candidate | 489,970,107 | 6,807 | 494,867,896 | `34bce77c0e00af700bec50594742f35c0f328c9a93571e113eb2afa45f847b08` |
| `archive-near-1gib` | synthetic archive ceiling | 1,073,039,669 | 64 | 1,072,741,592 | `62f90427174e143c8eda39c40d7e4553dfc3dfdee6fb3b2517135490b98a9ac7` |
| `entries-20000` | synthetic entry ceiling | 5,737,177 | 20,000 | 10,685,628 | `5dffad2ec4cd759d0863e3b102d91fb9d8bbbe8c49d187bcfb61712a2ea19d0c` |

The real regional preview reported 33 MiB stored and decoded. The real volume
preview reported 472 MiB stored and 2,264 MiB declared codec-decoded data. The
volume is the D054-reviewed, validated-real-local depth-four candidate; this
import result is not the Q5 production-transport decision.

## Exact adversarial corpus

| Case | ZIP bytes | Entries | Declared expanded bytes | SHA-256 | Intended rejection |
| --- | ---: | ---: | ---: | --- | --- |
| `duplicate-path` | 230 | 2 | 4 | `7d36e123376b5998ed18fb7313797ef99ccc6d85d4a90a1041765ea8c0d6e92f` | duplicate root path |
| `enclosing-directory` | 142 | 1 | 2 | `91e5a860a6d0b995727906e8b988200fddf01ed184fd07420b5ecac13d2cfaeb` | root manifest enclosed |
| `parent-traversal` | 229 | 2 | 3 | `2e88720a67d8e8bd375e2a69ac30938cd0edeb904c286a974bce5e84ae646e3a` | path traversal |
| `percent-ambiguous-path` | 245 | 2 | 3 | `4230e80ab23d96eb3d0e24726153438eceedca664202786390ccf6e49aae00d8` | percent ambiguity |
| `nested-zip` | 226 | 2 | 4 | `f08a53e1c4e75945916c17da9bbf2db28f446cc0e3e232ccf973b7d3bbafb74e` | nested ZIP |
| `unsupported-compression` | 126 | 1 | 2 | `3be83bc0fcdac0374018e82b427cf6b6a3613d3cf353e01d6b74312f6164449c` | method 12 |
| `entry-expanded-size-over-limit` | 126 | 1 | 268,435,457 | `babf891c1d5f841825c9df36c6f732793f3f5ca909a7b736c384740c5b069334` | per-entry limit + 1 |
| `compression-ratio-over-limit` | 125 | 1 | 1,001 | `d8c0ad257612078a8a02db791f50d02a5becf272bcf670be147bb8be584fd56b` | exact 1,001:1 ratio |
| `aggregate-expanded-size-over-limit` | 744 | 7 | 1,610,612,738 | `58e93f87bd4d2ec4ac3319638889705f62c3d952ac428220a21e3b91929932bf` | aggregate limit + 2 |
| `entry-count-over-limit` | 2,200,126 | 20,001 | 2 | `e58c4b9a7c6da5f1e9c6bf102912f1af73d7376fd52cc0184796ca72f7766a88` | entry limit + 1 |
| `crc-corruption` | 126 | 1 | 2 | `5eb94d6652dc4007ca8e9673619ed8d457ce4a01fea5d45fab094183e87b4d6f` | corrupted stored payload |
| `path-segment-over-limit` | 479 | 2 | 3 | `43508154b1afca10fe9f406e6565ce4d280f8ddb2df1a0eebb1aa554dc888f9d` | 129-byte segment |

All cases rejected during preview in Chromium, Firefox, and Playwright WebKit,
and every recorded final database contained zero manifests and zero resources.
This is a deterministic adversarial matrix, not coverage-guided random fuzzing.

## Browser measurements

Times are elapsed wall-clock milliseconds for the named phase. They are not
performance thresholds. Storage and browser-profile state were fresh for each
case; the harness used one worker and no retries.

### Exact real releases

| Browser | Case | Preview | Admission | Reload | Deep verify | Delete | Outcome |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| Chromium | regional | 1,982 | 283 | 298 | 966 | 466 | pass; final DB empty |
| Firefox | regional | 3,020 | 7,932 | 590 | 1,116 | 770 | pass; final DB empty |
| Playwright WebKit | regional | 1,409 | 120 | — | — | — | admission rejected by WPE Blob storage |
| Chromium | volume | 13,252 | 664 | 200 | 5,482 | 422 | pass; final DB empty |
| Firefox | volume | 24,128 | 43,294 | 280 | 7,308 | 672 | pass; final DB empty |
| Playwright WebKit | volume | 12,174 | 161 | — | — | — | admission rejected by WPE Blob storage |

The WebKit rejection was `Error preparing Blob/File data to be stored in
object store`. Preview and all pre-admission validation completed; admission
rolled back to zero records. The same behavior occurred for smoke, real,
1-GiB, and 20,000-entry cases. It is a limitation of the Playwright Linux
WebKit/WPE IndexedDB implementation used here and must not be reported as a
native Safari failure.

### Capacity boundaries

| Browser | Case | Preview | Admission | Reload | Deep verify | Delete | Outcome |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| Chromium | 1,023 MiB ZIP / 64 entries | 4,667 | 324 | 244 | 2,041 | 425 | pass; final DB empty |
| Firefox | 1,023 MiB ZIP / 64 entries | 26,493 | 1,354 | 399 | 2,657 | 602 | pass; final DB empty |
| Playwright WebKit | 1,023 MiB ZIP / 64 entries | 4,839 | 57 | — | — | — | WPE Blob admission rejected; rollback clean |
| Chromium | 20,000 entries / 5.5 MiB ZIP | 21,895 | 3,087 | 272 | 3,422 | 1,311 | pass; final DB empty |
| Firefox | 20,000 entries / 5.5 MiB ZIP | 85,048 | 115,139 | 363 | 10,539 | 1,909 | pass; final DB empty |
| Playwright WebKit | 20,000 entries / 5.5 MiB ZIP | 15,751 | 376 | — | — | — | WPE Blob admission rejected; rollback clean |

Chromium reported roughly 10 GiB initial origin quota. Its 1-GiB case reached
1,073,411,059 bytes of reported usage after admission. Firefox reported a
10,737,418,240-byte quota and 1,073,522,122 bytes of usage. Both reloaded,
deep-verified, deleted, and ended with zero database records. These observations
exercise available quota; they are not a forced real-quota-exhaustion test.

GNU `time` around the Playwright wrapper recorded the following maximum-RSS
signals (KiB):

| Case | Chromium | Firefox | Playwright WebKit |
| --- | ---: | ---: | ---: |
| real volume | 789,332 | 955,164 | 242,244 |
| 1,023 MiB ZIP | 1,184,256 | 487,588 | 249,240 |
| 20,000 entries | 608,220 | 607,160 | not recorded |

These numbers describe the timed command's operating-system accounting, which
can include the Node harness while omitting memory in separately managed
browser descendants. They are useful regression signals only; they are not a
portable browser-process-tree peak or a browser heap measurement.

### Native Safari

Native Safari passed the focused authored fixture and both representative real
archives. Milestones below are cumulative from driver start because the small
stdlib WebDriver runner records user-visible readiness rather than the
Playwright phase boundaries.

| Archive | Preview ready | Admitted | Reload and views ready | Outcome |
| --- | ---: | ---: | ---: | --- |
| authored regional fixture, 4,491 bytes | 1,697 ms | 2,008 ms | 2,513 ms | pass |
| real regional, 8,733,904 bytes / 1,136 entries | 4,356 ms | 5,349 ms | 5,875 ms | pass |
| real volume, 489,970,107 bytes / 6,807 entries | 47,122 ms | 55,477 ms | 56,099 ms | pass |

For both real cases Safari displayed the expected identity/provenance preview,
admitted the release, selected the expected feature and local URL identity,
then restored the feature and summary after reload. Native Safari quota,
persistence, process RSS, deep verification, deletion timing, and exact
1-GiB/20,000-entry boundaries were not captured.

## Limits decision

The outer ZIP limits remain unchanged:

| Limit | Retained value |
| --- | ---: |
| ZIP archive | 1 GiB |
| entries | 20,000 |
| compressed or ZIP-expanded bytes per entry | 256 MiB |
| aggregate ZIP-expanded bytes | 1.5 GiB |
| expansion ratio per entry | 1,000:1 |
| UTF-8 path / path segment | 512 / 128 bytes |
| expanded root manifest | 8 MiB |

Schema resource decoding is an independent budget. The campaign found that the
real 467-MiB volume archive validly declares 2,264 MiB of codec-decoded data, so
the former 1.5-GiB aggregate decoded ceiling would reject the representative
release despite its bounded per-resource layout. The implemented decision is:

| Decoded limit | Value |
| --- | ---: |
| codec-decoded bytes per resource | 256 MiB |
| aggregate declared codec-decoded bytes | 3 GiB |

The validator preflights the complete declared graph with safe-integer
arithmetic. Gzip decoding is streamed and stops at the declared/admitted
length; it is not allowed to materialize an unbounded inner expansion. The
3-GiB number is a declared-graph safety ceiling, not a claim that 3 GiB is held
simultaneously or is supported on every browser/device.

## Resilience and recovery evidence

- Cancellation is tested before archive work and during schema-graph
  validation. Signals propagate through traversal, encoded reads, and streaming
  decompression; WebCrypto digest itself is bounded but not cancellable, so the
  signal is checked immediately before and after it.
- Preview remains read-only. Admission uses one IndexedDB transaction and is
  intentionally completed atomically after confirmation rather than exposing a
  misleading mid-commit cancel action.
- Synthetic quota exhaustion produces recovery guidance and leaves no partial
  manifest/resources. Real quota exhaustion was not forced.
- Duplicate import cannot replace an immutable local release. Confirmed delete
  is isolated, falls back deterministically, and permits exact reimport.
- Deep verification detects damaged IndexedDB resources; recovery is atomic
  deletion and reimport. Published browsing remains available when local
  storage or a local row is unavailable.
- Real and boundary benchmarks prove reload, deep verification, deletion, and
  zero final records in Chromium and Firefox. The WPE Blob failures likewise
  leave zero records. Native Safari proves import/render/reload for the real
  regional and volume archives.
- The deterministic malformed corpus covers duplicate/ambiguous paths, parent
  traversal, enclosing directories, nested archives, unsupported compression,
  CRC corruption, per-entry/aggregate/count/ratio excesses, and path-segment
  excess. Unit tests separately cover missing/undeclared resources, wrong
  hashes, unsafe integers, overflowing shapes, decoded budgets, and inner-gzip
  bombs.

Concurrent import/delete scheduling, tab/process termination during admission,
native Safari forced-quota recovery, and cancellation latency at every possible
digest boundary were not measured in this campaign.

## Memory and support caveats

The harness captured `navigator.storage` where implemented and Chromium's
`performance.memory` snapshot. Firefox and WebKit expose no comparable JS-heap
telemetry, and much archive/Blob/IndexedDB memory is outside the JS heap. The
wrapper RSS signals above are not process-tree measurements. Therefore this
record makes no portable browser peak-memory claim; the host's 128-GiB RAM also
does not represent a typical user device.

The defensible supported-capacity wording is provisional: representative real
regional and 467-MiB/6,807-entry volume archives passed Chromium, Firefox, and
native Safari; the 1-GiB and 20,000-entry safety boundaries passed Chromium and
Firefox. Playwright WebKit preview/rejection coverage is useful but its Linux
Blob-storage failure prevents successful admission evidence. Do not advertise
1 GiB, 20,000 entries, 1.5 GiB expanded, or 3 GiB decoded as a universal Safari
or low-memory-device guarantee until native quota/RSS and representative
hardware evidence are recorded.
