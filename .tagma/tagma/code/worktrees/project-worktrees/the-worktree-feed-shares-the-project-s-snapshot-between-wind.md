---
id: 01a1364d-8e27-7d91-9820-00c891dd880e
title: The worktree feed shares the project's snapshot between windows, and keeps idle facts signed with a witness instead of recomputing on base movement
ord: 5
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a13618-8c31-7e1f-b2fe-6db10d2fb993
sources:
  - kind: file
    ref: apps/tagma/server/src/worktrees/listing/membership.ts
  - kind: file
    ref: apps/tagma/server/src/worktrees/listing/mergeChecks.ts
  - kind: file
    ref: apps/tagma/server/src/worktrees/listing/metadata.ts
  - kind: file
    ref: apps/tagma/server/src/worktrees/listing/readings.ts
  - kind: file
    ref: apps/tagma/server/src/worktrees/listing/windows.ts
---
The project feed holds a shared snapshot of metadata and stored facts: a subscription window switch takes a slice of that snapshot instead of walking checkouts again. Only the metadata subscriber gets the full list of places in the first frame, then changes; window lines and totals arrive separately. Visibility holds no checkout observer. A line the observer brings with no metadata movement that equals the shown one is the feed's own read echo (`CheckoutRows.read` publishes what it read to the same subscribers) and wakes no new read; one that arrives during a read is reconciled against its result, and a mismatch rereads metadata like a repeat. The main checkout, the checkouts of working and waiting threads, and copies published by the pool are observed.

An idle invisible line never starts a state or merge-tree read. A HEAD stored by git for a missing worktree proves no directory: another check's completion never runs git in it and never ends the feed. State is stored in the machine database at the HEAD and index stat, the verdict by directory and branch tip, together with the base, driver revision, and merge-config fingerprint. A diff and divergence of one snapshot take one fixed commit of the base. One base's movement never starts a new check: old values stay signed by their witness. The current pair is checked by an explicit check or merge act; cleanup rereads state before deciding.

All consumers' checks share one Capacity pool. Main, worker, and visible-line reads go in a small machine-dependent call band without HEAVY, so on a single-band machine main state arrives even during a long merge check. An explicit act gets the call class, the feed the background one; simultaneous requests for one pair share one flight, and a priority change never duplicates work; a request that finds no flight takes the pair's stored verdict before creating its own, when it was stored while the request read the stored state. The feed publishes the stored verdict, queue, and format progress without waiting for a check; its completion projects the stored verdict of only its own line into the shared snapshot and starts no new check, while that read's failure stays a line warning, not the end of the feed. Deletion first interrupts the flight and deletes stored facts; state saving checks live root membership in its own transaction so a late answer never restores a deleted record. A check failure stays unknown with a reason; an explicit act may check the same pair again.
