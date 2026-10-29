---
id: 01a17e4c-3026-712f-9993-0a6bc9ada5b9
title: Default switch carries live SDK threads to the new account at the nearest step boundary, and the turn that failed on the old account's limit continues
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17e4d-10ef-71d7-a37e-1fcca0765697",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a17e4c-13fe-78eb-a310-2ebe08c44611
---
Part "SDK/ACP threads" and acceptance 1–3 of spec [[08c44611]]: on `defaultAccountMoved`, hosted threads that follow the default and stand on a different account are freed at rest or carried by `carryModelMove` at a step boundary; a turn that ended with a limit refusal on the departing account continues. The same change corrects [[076a4c60]] and [[a65d1a0a]].
