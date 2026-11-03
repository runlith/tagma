---
id: 01a1a183-c38c-72bb-8d73-20eaafa95730
title: Keep independent peer entries out of line-sliced landings
ord: 156
tags: ["task"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: discovered-from
    to: 01a19556-0814-792b-ab3a-d8d1b4f42e09
---
A landing of a caller's manifest entry must leave independent live-peer entries and their fixtures for their holder while preserving genuine edit dependencies and correct authorship on subsequent landings. A native-door test reproduced the carry in this order: a child inserted a JSON entry at the start of a tracked manifest; a live peer inserted and revised another entry before it; the parent deleted an existing entry; the child revised its entry; the peer inserted two more entries at the start; another writer changed a separate existing entry and landed it; the parent then submitted the child's entry and fixture with `taking`. The commit contained all three peer entries without their fixture. The temporary test failed on those entries in 11.9 s and was removed at wrap-up; its simplified intervening landing did preserve the parent's deletion, unlike the original report. `lines/provenance.ts` can link different writers on repeated text in one shortest-diff region; whether that caused this carry is unproved.