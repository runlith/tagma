---
id: 01a1a26a-0eff-710d-ba5e-cdddc6982956
title: A release awaiting new-host consent keeps its baseline and survives a server restart
ord: 78
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/installation/closure/pending.ts
  - kind: symbol
    ref: apps/tagma/server/src/installation/process/succession.ts
    symbol: processSuccession
---
A host refusal is a machine choice that outlives the server reporting it. Its record names both the pending release and the digest it was offered over; it remains actionable only while that baseline or the pending release is current, so an unrelated installation never revives an old choice. Pruning keeps that release until the choice is stale, and the successor clears the record when it starts from the chosen release.