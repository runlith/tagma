---
id: 01a11b52-d4b3-731f-86ed-9ab1c4e2d33c
title: "Observer scenario: the production surface fits the budget — list, feed virtualizer, growing-message markdown"
ord: 5
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a11901-470f-7498-99ae-69f003fb96bb
  - kind: implements
    to: 01a118f1-5f59-7eb8-856a-a0e833589ccf
---
The full observer scenario (bench 7830a02ed2, `bun run bench:observer` in `apps/tagma/server`) on the production surface misses the [[33589ccf]] budget: the main thread is busy 91–96%, long tasks up to 269–1316 ms. Measurements ran on a loaded machine (load 11–56); this is a sample.

Breakdown by measurement:
- idle: 4.4%;
- 11 working threads, open thread idling, no presence: 69% — the list column;
- open thread streaming: 95%;
- one working thread without throttle: feed→frame p50 247 ms, p95 1.17 s at model→feed 0.1 ms — the delay is on the client.

Profile: Svelte reactivity (`mark_reactions`, `is_dirty`), keyed `reconcile`, `getBoundingClientRect` and scroll-metric reads, `virtualizer.resizeItem`, `parseFromString` markdown.

Make: profile by component and remove cost at its owners — the list-row update path, the feed virtualizer and follow-bottom, growing-message markdown re-parse ([[2393aff1]]).

Done: cost removed at the owners — `3a77892f11` (one `Intl.DateTimeFormat` per locale, no layout reads in flush, tail only on shape change), `cb405ec30c`, `f3205df054` (membership signal instead of re-reading), `31a5e0dda3` (`Squeeze` per row, minute tick instead of per-second). The operator declined the bench (2026-10-08): the effect unmeasured.
