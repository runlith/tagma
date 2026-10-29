---
id: 01a16603-f3c1-7c0c-8092-f25a22d81ba0
title: Server raises RSS to 3–4.3 GB at start, twice what it holds minutes later
ord: 150
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16604-279b-7ef7-b708-105d9cb6a551",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a13662-e32c-7bec-9643-6acc19d1811a
---
In the first minutes after start the server raises RSS to 3–4.3 GB, although after a few minutes it holds 1.7–2.8 GB. On a machine with 8–16 GB such a peak puts pressure on the whole system.

**Measurements 2026-10-22 (vitals, one process each).**
- Instance `c5035159` (build `head-20261022T233824436Z`): about 3.5 min after start RSS 1.66 GB, `rssPeakBytes` 4.33 GB, committed 5.07 GB; JS heap ~0.34 GB, external ~0.15 GB.
- Instance `689b54fe` (installation `20261022T214319778Z`): at minute 2 RSS 2.12 GB, peak 3.1 GB; by minute 31 peak 6.0 GB.
- In the first ~10 s of instance `c5035159` ran `Retirer.pass` 11.4 s, `Holdings.wait` 10.9 s, `WorktreeFeed.open` 10.3 s, `CheckoutRows.*`, `ThreadEventStripping.pass` 7 s, `ThreadRollout.evict` 6 s — candidates, unmeasured.

The peak lies mostly outside the JS heap (heap 0.3–0.6 GB at RSS 2–4 GB). Related to [[19d1811a]] (RSS growth through allocator retention under load), but this is a different question: what allocates gigabytes at start.

**What to do.** On its own instance (`tagma:try`, own root and port; do not touch the live server) catch the start peak: vitals and a memory snapshot in its window, name the producer, and remove the peak at it.

**Proof.** `rssPeakBytes` in the first 5 minutes on the same database, before and after.
