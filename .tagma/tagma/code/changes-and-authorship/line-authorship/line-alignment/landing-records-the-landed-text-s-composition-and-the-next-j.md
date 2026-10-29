---
id: 01a176b7-6308-7f25-851e-68a39f26b778
title: Landing records the landed text's composition, and the next judge assembles HEAD from it instead of aligning the base to the text
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
    ref: apps/tagma/server/src/change-record/lines/selection.ts
    symbol: selectFold
  - kind: symbol
    ref: apps/tagma/server/src/change-record/store/retirement.ts
    symbol: changeLanded
---
Landing records the composition of the landed text, and the next judge assembles HEAD from it instead of aligning the base to the text.

After landing, HEAD is no longer the version the fold recorded, and `projectWork` used to align the fold's base to it by text. Among equal lines (`}`, `},`) the alignment continued the wrong base line: the landed line read as someone else's deleted line, and the next landing's slice lost or doubled a bracket while the landed holder kept a phantom hand.

The slice knows which line of the text it builds each line comes from, and landing records that composition in `change_landed` keyed by the digest of the landed text: lines present in the working file (continuing and added) point at the working file at slice time; HEAD lines removed by non-landing edits and therefore kept point at HEAD at slice time. The judge reads the path's compositions alongside the other evidence, and when the HEAD digest matches a composition, the fold assembles HEAD from its own snapshots of those two versions: every line's identity is exact, with no alignment. HEAD at slice time may itself be an earlier landing — then it is assembled by its own composition.

A composition only applies while HEAD is byte-equal to the landed text: when commit steps, hooks or a rebase onto a shifted branch changed the file, the judge aligns by text as before. When the working version is missing from the fold's snapshots, the composition is not used. When the former HEAD is missing from the snapshots (the fold starts at the first standing record while the landed edit was recorded earlier — [[4267fd67]]), kept HEAD lines are recognized by the record that deleted them: the composition stores, for each such line, the record that deleted it and the line number among that record's deleted lines. A record's hunk yields the same deletions in any fold where it replays, so the line takes the same point as at slice time. Only when the deleting record is missing from the fold, or the text point does not match, does the line take its point from textual alignment — except lines already standing in the working file; such a HEAD does not count as traced, and holding on the shortened pair ([[bf2012e8]]) stays off on it.

Compositions are state for later judges, so the table is declared as entities, not history. Every landing deletes the compositions of its checkout's paths that have no standing lines left: with no lines on a path there is nothing to judge.
