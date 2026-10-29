---
id: 01a16d33-8982-7984-9c2f-4f4fe978f1ff
title: A formed-line deletion stays nobody's when the form step changes the line count, and a peer's landing can then commit a duplicate
ord: 67
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16d17-c236-71fc-87b6-65116f13c574",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a16d17-9430-7444-afab-182a2eb0e214
---
A formed-line deletion stays nobody's when the form step changes the line count, and a peer's landing can then commit a duplicate.

Remainder after fixing [[2eb0e214]] (bc2cf066aa). Fold matches "formed line ← source" only over step-debt windows where the line count before and after the form matches. When a formatter changes the line count inside the window, there are no pairs, the formed HEAD line's deletion reads as nobody's again (`external`, why steps). Then a peer's replacement of that line lands as an insertion, as before the fix: the peer's commit carries a line nobody wrote.

Next to it is the neighbouring-owner case (MINE edits a neighbouring line): the author's unformatted tail stays on disk, and the debt hangs until that path's next landing. That may be correct behaviour; the decision belongs in [[7c039263]] or [[a2c44f94]].

No test pins these cases. Done when:
- a red-then-green check through `submit_work` exists for a window with a changed line count (`composition/testing/change-record/stepDebt.itest.ts` or nearby);
- a peer commit carries no nobody's lines;
- the neighbouring-owner tail decision is recorded.
