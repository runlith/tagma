---
id: 01a0e945-59c5-7e65-981b-ae4957330581
title: "Release cleanup: squash migrations, remove every legacy and transitional path, empty all debt before the first public release"
ord: 90
tags: ["task"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: implements
    to: 01a0e945-3c0d-7dd6-867c-7215173580c0
  - kind: waits-on
    to: 01a0e532-c6b3-77c5-9b20-b28711bddc33
---
Implements [[173580c0]]. Starts once every restructure wave has landed and been merged into main. Its checklist is the "Legacy to remove before first release" section and the squash item in the merge list [[4a9013bf]]; done when the decision's acceptance holds.