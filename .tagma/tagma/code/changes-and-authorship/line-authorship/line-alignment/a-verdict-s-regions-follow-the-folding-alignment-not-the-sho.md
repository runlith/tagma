---
id: 01a1767e-e33d-734b-83f0-2fe5bf2012e8
title: A verdict's regions follow the folding alignment, not the shortest diff that pairs equal lines of different edits
ord: 8
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a17648-cb2e-75fc-b4e3-abd0dfcaaf81
  - kind: relates
    to: 01a164ac-5375-72c2-88f0-87a20c6f0a9e
  - kind: relates
    to: 01a173e9-986d-7f3b-ade4-c9f3fbf522ca
sources:
  - kind: symbol
    ref: apps/tagma/server/src/change-record/lines/projection.ts
    symbol: anchoring
  - kind: symbol
    ref: apps/tagma/server/src/change-record/lines/projection.ts
    symbol: cancelledOf
  - kind: symbol
    ref: apps/tagma/server/src/change-record/lines/projection.ts
    symbol: sliceRegions
  - kind: symbol
    ref: apps/tagma/server/src/change-record/lines/projection.ts
    symbol: summarize
---
The judgement's counters are the shortest diff of HEAD against the working file. It is free to pair equal lines whichever way is cheaper: a `},` inserted by one edit cancels a `},` deleted by another, and when every block before a surviving block is deleted and blocks are inserted after it, pairing brackets is cheaper than the surviving block itself, so it comes out deleted and re-inserted. Lines and regions built from that diff would put a HEAD line in someone else's place and tear a surviving block, though the working file is valid.

So the regions of a verdict, which authorship reads and the court's line holders rest on, are the gaps between folding anchors, the folding's own alignment: continuing lines are never cut, everything between them is an edit's insertion or a deletion with its recorded deleter. The shortest diff only splits a gap on a pair the folding cannot trace: a HEAD line with no recorded deletion (for example, a landed copy of a working line) and an equal working line — here textual pairing is the only identity. A gap line takes the shortest-diff line mark at the same position when there is one, otherwise the exact one: the recorded deleter or the working-line edit. `lines`, `counts`, `hands` and `nobody` counts, and repeated-line links (`linksOf`) keep the shortest diff.

Inside a region, an inserted line stands right after the HEAD line its point (`follows`) stands on, not after all deleted lines of the region. When the point has no HEAD, its place is the nearest previous line of its source in HEAD, and before that source's first line — the source's left edge (its left neighbor and the lines it deleted); that place advances through untraced HEAD lines that took the point's place (replacement by alignment). A source with no HEAD at all stands on its left edge.

A path's shortened pair makes both sides holders — a hand with no lines in the count, a line in `standing`, the nobody side in `unheld` — only when the edits belong to different holders and the HEAD-line identity is its own: HEAD is a version the folding recorded itself, or assembled whole from a landed composition ([[9f26b778]]). When HEAD is text-aligned even partly, alignment among equal lines may name the wrong one, and holding from such a pair would credit a phantom line. Without holding, a peer whose only line shortened would be invisible to the court.
