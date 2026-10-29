---
id: 01a16527-352c-7185-bffb-404ef8ae63e1
title: submit_work names the tasks of everyone whose lines it lands — its own, taking, and carried — with their holder and standing
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16527-9bb9-75cd-8715-38ca1bc07314",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a16527-352c-7185-bffb-404d3490910c
---
Now the answer names only the holders of taken lines (`carried lines of <holders>`, `landing/voice.ts`), and tasks of only its own session and `taking` (`landing/operations/submit.ts`). The answer gets each `carried` holder's tasks in one `HeldTaskLabels.forHolders` call, with the line: "carries work T (held by X) — finish_block T with this commit if it completes it". Landing neither closes tasks nor changes the commit subject. The `landing/doctrine/commits.ts` text: a hand-off names tasks; whoever lands a child's lines also decides its tasks. Test at the `submit_work` door on the [[87a7ab7d]] scenario: session A holds T and lines in F, session B lands `paths ["."] whole ["."]` — the answer names T as carried by A. Red before the fix.
