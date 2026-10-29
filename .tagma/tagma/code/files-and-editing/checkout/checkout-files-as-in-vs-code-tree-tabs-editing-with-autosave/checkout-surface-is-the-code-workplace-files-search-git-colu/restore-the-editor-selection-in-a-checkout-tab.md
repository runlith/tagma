---
id: 01a151a6-f027-7404-ac74-6e6ac8fb6f8a
title: Restore the editor selection in a checkout tab
ord: 5
tags: ["task"]
fields:
  {
    "holder": "tagma:01a151a6-a001-7ba3-be29-65c40ad76bab",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a117dd-98e5-7df2-86cb-e3fbb51edd1b
sources:
  - kind: symbol
    ref: packages/code-editor/src/marks.ts
    symbol: Seen
---
Confirmed: Editor passed only head, and tabs stored only the cursor. The Seen contract now carries the primary selection anchor; direction and multirow range survive teardown, PlatformStorage, and reopening. Old entries without an anchor stay a cursor. Checked: Editor 2/2 on the new TextDocument, Tabs 7/7, code-editor typecheck without errors. App typecheck did not finish in the 10-minute command window and was killed with SIGKILL; a clean app check is not proved. In a randomly captured full code-editor set the old document.test.ts:55 failed on a 5000ms wall timeout, the selection test passed separately.
