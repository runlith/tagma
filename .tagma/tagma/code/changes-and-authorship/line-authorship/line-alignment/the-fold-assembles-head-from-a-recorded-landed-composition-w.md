---
id: 01a176b7-6308-7f25-851e-68a39f26b778
title: The fold assembles HEAD from a recorded landed composition when one matches, instead of aligning the base to the text
ord: 9
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a1767f-39ae-767b-8cd6-f4beab6b7cac
  - kind: relates
    to: 01a1767e-e33d-734b-83f0-2fe5bf2012e8
sources:
  - kind: symbol
    ref: apps/tagma/server/src/change-record/lines/landed.ts
    symbol: landedRoot
  - kind: symbol
    ref: apps/tagma/server/src/change-record/lines/projection.ts
    symbol: projectWork
  - kind: symbol
    ref: apps/tagma/server/src/change-record/store/retirement.ts
    symbol: changeLanded
---
After a landing, HEAD is no longer the version the fold recorded, and `projectWork` aligns the fold's base to it by text. Among equal lines (`}`, `},`) that alignment can continue the wrong base line, so a landed line reads as someone else's deleted line and the holder keeps a phantom hand.

A recorded landed composition removes the guess. It is keyed by the digest of the landed text and says which line of the text comes from the working file at slice time and which comes from the former HEAD; kept HEAD lines absent from the fold's snapshots are recognized by the record that deleted them and their number among that record's deletions. When the HEAD digest matches a composition, the fold assembles HEAD from its own snapshots of those two versions, with no alignment. It applies only while HEAD is byte-equal to the landed text and the working version is among the snapshots; otherwise the judge aligns by text. A path fold that replays departed records ([[4267fd67]]) relies on the same coordinates, and holding on a shortened pair ([[bf2012e8]]) stays off where a HEAD line is only text-aligned.

Whole-file landing slices nothing, so no landing records a composition any more: the table is only read, and every landing deletes the compositions of its checkout's paths that have no standing lines left. Compositions stored before still apply.
