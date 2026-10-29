---
id: 01a11986-80fb-7290-bbe6-3fe9b5ef2760
title: "Reasoning tail in presence: appends by (runId, entryId) with drop from entry deltas"
ord: 1
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a118f1-5f59-7eb8-856a-a0e833589ccf
  - kind: relates
    to: 01a11901-5360-733e-9ca2-9123ae16171c
---
The open-reasoning-entry tail part of [[33589ccf]]: built on entry deltas ([[c3436715]]), so it waits for them. The rest of the presence feed (row from `RunStatus`, subscription index, `missing`/`archived`, consistency) is built by the parent without them.

Done: tail tests from the spec — reset on a new entry, settlement, and withdraw; a stream through the limit gives exactly the producer tail, including non-BMP characters and reconnect on the cut boundary.
