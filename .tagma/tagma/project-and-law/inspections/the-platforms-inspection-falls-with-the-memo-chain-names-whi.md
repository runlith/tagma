---
id: 01a11912-55f9-7d3a-a640-35c70ffe89fb
title: The platforms inspection falls with "the memo chain names …, which the store no longer holds" and locks submit_work for every change in the repository
ord: 18
tags: ["task"]
fields:
  {
    "holder": "tagma:01a11911-ea21-7cf0-9de1-3788cc3c1b04",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a118df-7dd7-7b8b-af1c-240c49b24903
sources:
  - kind: file
    ref: apps/tagma/inspection/src/packs/js/platforms/closure.ts
  - kind: file
    ref: apps/tagma/inspection/src/packs/js/platforms/walk.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/workers/caches.ts
---
2026-10-08 ~01:10 rule 50520d64 (`platforms`, gate before submit_work) failed to judge a change three times in a row and answered `inspection-failed`: `platforms: the memo chain names platforms/dependencies/01648eaccd968d4fd26bc1763f3c406f87c3517b3410b03f5bf3eee75b946848, which the store no longer holds`, HEAD `ebdd506c67`. Thrown by `collectInto` in `closure.ts` when a memo entry points at a dependency the cache no longer holds. Shortly before, the execution host had been replaced (`stop:host-replace`). The other eight rules passed.

Likely cause, unverified: the inspections cache (`openCache` with the `MEMO_BYTES` budget, 32 MB) evicts a dependency or, after degradation, "answers as empty" for it, while the entry pointing at it stays and passes `validMemo`. The root is that a missing chain link counts as a fatal error instead of a cache miss after which the entry is recomputed.

Done when an entry with a missing dependency is recomputed instead of refused, and a test holds the case: a cache with an evicted dependency gives the same verdict as an empty one.
