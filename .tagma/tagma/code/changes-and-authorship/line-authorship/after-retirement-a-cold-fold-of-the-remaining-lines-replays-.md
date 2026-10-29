---
id: 01a176b7-7ebf-7d63-ac5a-90cf76a1124d
title: After retirement, a cold fold of the remaining lines replays departed edits as a textual break and can pick the wrong one of equal lines
ord: 77
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17649-5aac-796f-b4a0-9033e9160ee2",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a1767f-39ae-767b-8cd6-f4beab6b7cac
  - kind: relates
    to: 01a176b7-6308-7f25-851e-68a39f26b778
sources:
  - kind: symbol
    ref: apps/tagma/server/src/change-record/holdings/inputs.ts
    symbol: assembled
  - kind: symbol
    ref: apps/tagma/server/src/change-record/lines/folding.ts
    symbol: appendWork
---
After retirement, a cold fold of the remaining lines replays departed edits as a textual break and can pick the wrong one of equal lines.

Retirement removes the landed holder's lines, and the path fold restarts from the before of the first remaining line. It replays the departed lines' edits lying between the remaining ones as a break step `external` — a textual diff between snapshots rather than their recorded hunks. Among equal lines that diff can pick a different line than the edit's own line picked: then the working file's line identity in the fresh fold diverges from the recorded edit and from the landing composition ([[ab6b7cac]]), and the next landing's slice loses or doubles a bracket.

Example (block-fuzz, seed 146, JSON): base n0, n1, n2, n3; A deletes n2 and inserts n4 before n3, B deletes n3, C inserts n5 before n1; landings C, B, A. Line B deleted n3 whole, with its `},`; in the fold before A's landing the break at the place of departed B and C deletes the `},` of A's insertion and keeps the `},` of n3. HEAD assembled by composition is exact, but the closing line of n4 in the working file turns out to be a base line missing from HEAD, and A's slice never takes it.

Measured, 3000 cases × 3 landing orders, fold after retirement: 127 chains break on a late landing out of 21170 steps with landing composition and 148 without (20 chains break only with composition, 46 only without); without retirement with composition — 0.

Direction: a path fold takes a window — every record of the path starting at the first standing one, in any state — and replays departed records inside the window with their recorded hunks rather than a textual break. Departed records before the first standing one are dropped: their edits already lie in the window base. Measured on the same block-fuzz with landing composition: 0 late breakages instead of 127; 2 of 21204 steps leave the landed holder a phantom hand. For that:
- departed records' texts and hunks are kept while standing records hold them inside the window, and collected as the window shifts;
- a departed record's path never makes anyone a holder: when its lines reach the verdict they are nobody's with the step debt explained;
- Holdings computes `domain`, annotations and holders over standing records only.

Done in two commits.
- `8c62698fc8` — the fold window ([[4267fd67]]): departed records after the first standing one replay as hunks. The collector never removes their hunk while a standing record holds it; the trigger queue is rewritten and a partial index added for that. Records that cannot replay without assembled texts stay a break.
- `423b5e775d` — HEAD lines a landing kept are recognized by the fold through the record that deleted them ([[9f26b778]]).

Measured on the same block-fuzz after retirement with landing composition: 127 late breakages became 0; 0 phantom hands.
