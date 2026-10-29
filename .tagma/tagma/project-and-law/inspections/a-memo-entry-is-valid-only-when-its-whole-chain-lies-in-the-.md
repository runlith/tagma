---
id: 01a11918-bf27-7afe-817c-f6c9c9731fc6
title: A memo entry is valid only when its whole chain lies in the store; carried `Validity` spares comparisons but not the parent walk
ord: 19
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a11912-55f9-7d3a-a640-35c70ffe89fb
sources:
  - kind: symbol
    ref: apps/tagma/inspection/src/core/node/memo.ts
    symbol: checkedOnce
  - kind: symbol
    ref: apps/tagma/inspection/src/core/node/memo.ts
    symbol: Validity
  - kind: symbol
    ref: apps/tagma/inspection/src/core/node/memo.ts
    symbol: validMemo
---
A memo entry is valid when what it was derived from is unchanged, and when its whole parent chain lies in the store: consumers like `collectInto` in `platforms` read parents, and a valid entry with a dropped parent breaks the judgment with `inspection-failed`.

Store and `Validity` are two independent accounts. Store is the cache sqlite on the git common dir with a byte budget: it evicts entries by read recency, neighbouring workers clean it over their own connections, reset after corruption and degradation answer with emptiness. `Validity` with `Dependents` is the worker's in-memory counting index, surviving restart through `rest`. Neither sees the other's losses, so `Validity` only ever says "nothing under the key changed since the check" (`stands`), sparing object and listing comparisons but never installed-file fingerprint (`installed`) verification or the walk. Fingerprints are verified on every check: `Validity` derives from tree diffs, and a reinstall never changes the tree ([[edd30011]]). The walk: `validMemo` visits every entry's parents and reads them from the store; a missing one is a miss, after which the entry is recomputed.

Validity decisions made inside one read are remembered by `checkedOnce`, which `memoWrites` creates for every pass over `Validity`: within a pass each key is walked once, and the read values are held by `memoWrites` itself, so `collectInto` after `validMemo` finds the same chain. Only `stands` carries across passes, never "chain in place".

Rejected: telling `Validity` about store evictions — other workers evict too, as do file reset and restart, so such a channel is incomplete by construction; muting the refusal in `collectInto` hides a broken invariant at the consumer.
