---
id: 01a1176d-55fe-7931-b349-8c71dedebb61
title: Tools report the files they showed, rule delivery takes them as a list (parts 1–2 of spec 00c25ecb)
ord: 1
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a1175a-4c4e-7702-badc-614a00c25ecb
---
Done: `30ecdce384`, `6dc2a6149b`, `d3626c232e`, `ea939fe7ef` — `shown` and afterTool, tools and shellShown, list-form delivery, today's touchRule; touches are written for read/wrote, found brings the law and a pointer to the explanation.

Remainder of parts 1–2 of the [[00c25ecb|shown-files spec]]: deliver the law in one pass over the whole place list. Start with `graph/orientation/touches.ts:265–266`: the loop calls `rulesAtPlaces(projectId, [place])` separately per file, while `graph/orientation/law.ts:169–173` walks the whole reach again and builds the whole. Explanations and foreign touches already read batched; do not rebuild the kernel or the tools.

Proof of completion: public `Touches.touch` keeps the delivery and single delivery of rules/explanations in one law pass over the list; a cost measurement tells the single pass apart from repeated per-file passes, the affected packages' typecheck is clean. In the revision 5 shellShown, 31 bash, 5 touchRule, and 8 Touches tests passed; agent, agent-tools, and server typechecks clean.
