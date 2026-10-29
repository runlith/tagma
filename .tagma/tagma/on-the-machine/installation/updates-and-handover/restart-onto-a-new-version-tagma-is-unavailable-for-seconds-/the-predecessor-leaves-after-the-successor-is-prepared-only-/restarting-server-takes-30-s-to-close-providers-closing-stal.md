---
id: 01a1415a-e83c-72af-8b27-acb829207044
title: "Restarting server takes 30 s to close: providers closing stalls for 20 s, activity closing never finishes, emergency-deadline exit without releasing the catalog"
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1415b-1de3-7962-a578-3962aa87bc29",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a1415a-db80-7f6b-b559-38f85c98bd35
  - kind: implements
    to: 01a12699-1673-714b-a6a5-79e89b246531
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/runtime.ts
  - kind: file
    ref: apps/tagma/server/src/composition/server.ts
---
A server leaving for restart takes 30 s to close, and the whole time sits between doors: the successor does not open its own door until the predecessor is gone.

**Measurement (one sample, 2026-10-15 22:38, Tagma Dev, post-build restart, `~/.tagma-dev/restart.json` record, `serve.log`).** The predecessor closed its local door 1.9 s after the successor started; then `thread stack closed` 4.8 s, `served graphs closed` 5.0 s, and inside `machine runtime closed` the `providers closing` phase took 20.2 s while `activity closing` never finished. After 29.2 s the emergency deadline fired (`composition/server.ts`, `shutdown did not finish within 29200 ms; leaving`), the process exited without releasing the catalog, and the successor recorded `unreleased`. The flat 5 s, 5 s, and 20 s look like fired timeouts, not work — a guess this task verifies.

**To do.** Find what holds `providers closing` (`closing('providers', readyProviders)` in `composition/runtime.ts`), why `activity closing` never ends, and what keeps `thread stack closed` and `served graphs closed` busy; fix at the owner so that closing ends when the closing work is done, not when the deadline expires. The emergency exit deadline in `composition/server.ts` judges closing by time: establish on facts what it protects and what replaces it, and do that.

**Done when** a restart on one's own server instance (`tagma:try`) with running agents and open providers shows closing in the restart record with no phases stuck at a timeout, and a catalog release without `unreleased`. Spec [[9b246531]] — only ownership handover happens between doors.
