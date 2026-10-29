---
id: 01a0d136-c46b-714b-8717-8119c6ba14e5
title: "Replace the 24-hour child fold: live children only in handed order, \"N finished\", \"N more working\" past five, counts on a collapsed parent"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0d138-dc9c-78a5-9974-1e629459f2c2",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0d136-c286-7fd7-a1f3-6adde08ed2e3
---
Build [[e08ed2e3]] in `threadTree.ts` (`foldFinished`, a team count per node), `ThreadRow.svelte` and `threadFolds.svelte.ts`. A child standing on its descendants' life absorbs the defect of [[7885ea52]] — close that task with this commit. Done when the decision's acceptance cases hold on the page's 30-children data; write the claims and settle [[9fd52b92]], [[b0f9b795]], [[db76ba47]], [[966100e0]], [[8ccbf6dc]]. Size: medium.