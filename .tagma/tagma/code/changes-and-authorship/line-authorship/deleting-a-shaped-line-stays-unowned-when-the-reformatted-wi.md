---
id: 01a16d3f-3a0b-7cc2-8997-07b4a615b609
title: Deleting a shaped line stays unowned when the reformatted window's source lines belong to different record lines
ord: 68
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16d17-c236-71fc-87b6-65116f13c574",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a16d33-8982-7984-9c2f-4f4fe978f1ff
---
Deleting a shaped line stays unowned when the reformatted window's source lines belong to different record lines.

The remainder after [[e978f1ff]] (6de7b2340). A HEAD shaped line's deletion moves to the live record line only if it alone accounts for every source line in the window. If the formatter glued one line from several owners' text, the deletion stays unowned, and any owner's landing may leave the shaped line standing next to its own replacement. On top, no itest pins the reviewer's counterexample: an unrecorded deletion with a recorded double insertion.

Done when:
- a window glued from several owners' lines has a red-then-green check through `submit_work` (next to `composition/testing/change-record/stepDebt.itest.ts`);
- no owner's commit carries lines it never wrote, or it is explicitly recorded why such a window stays the author's debt;
- the reviewer's counterexample is pinned, if its outcome is expressible.
