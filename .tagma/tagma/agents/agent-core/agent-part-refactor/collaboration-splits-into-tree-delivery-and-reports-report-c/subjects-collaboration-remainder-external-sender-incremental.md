---
id: 01a11c57-49ce-7071-be4b-220ad7cc7840
title: "Subjects collaboration remainder: external sender, incremental incoming reads, keyset listing, durable residency"
ord: 1
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a11901-5360-733e-9ca2-912a1871beb0
  - kind: implements
    to: 01a118eb-3e7e-7085-8f2e-2cd787916291
---
Remainder of 1871beb0 (landed ee5bb5518d, 7614173e18, dbc3a3afac) on [[87916291]].

Done:
- O(C + R) report collection: child status deltas and `inbox.arrivals(threadId, after)` in both adapters and the conformance suite (a9387d11ed).
- Team keyset listing: `ThreadAggregateStorage.pageTeam` (running in full, resting in pages keyed `updatedAt desc, id desc`, `total`) in memory and in SQLite; `Threads.list` without `ids` reads running threads and one resting page, `latestRuns` in one batch (9dbf89351d, cdacd0a85b); conformance case on both adapters.
- Tree split: `ThreadSpawnTree` (births, limits, children, settlement) and `ThreadPlanes` (door, forkAccess, verbs) (b8a60ef393).
- Residency across restarts: places are not stored as a table but restored when resumed runs are re-admitted by the scheduler; proven by one restart case through the scheduler on both adapters (c68ae33ae4).

Not done, and why: the external sender with `caller`. `ThreadEnvelopeInput.senderThreadId` stays `string | null`; a sender outside a thread is written as `{ kind: 'host' }`. There is nowhere to deliver the answer to an outside caller: it has no inbox, so it needs an addressable report store (a reporting / delivery store) that does not exist. That is separate work on new storage.
