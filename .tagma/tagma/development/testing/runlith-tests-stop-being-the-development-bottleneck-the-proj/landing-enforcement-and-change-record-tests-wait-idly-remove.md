---
id: 01a17b46-3468-743a-b806-e20941341fea
title: "landing, enforcement, and change-record tests wait idly: remove the wait at the owner"
ord: 62
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17b4d-1368-78c4-9792-93ac8f784c67",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a16ac4-44bf-7e0a-8178-b6ff38ef1770
---
On a green server-integration run over 8 workers (757 files, 511 s wall, 2145 s CPU), test bodies wait 1512 s at 1597 s CPU. This area's files and their in-body waiting: `enforcement/commitGate` 31 s, `landing/submitDeletion` 28 s, `enforcement/remeasureIdle` 19 s, `change-record/programmatic` 17 s, `enforcement/landing` 15 s, `landing/place` 13 s, `change-record/revertLines` 11 s, `landing/steps` 11 s, `cli/hookAdoption` 11 s, `change-record/threadAuthorship` 10 s, `enforcement/copiedLaw` 10 s, `landing/submitGit` 10 s. Find what each waits for and remove it at the owner.
