---
id: 01a0d56a-99c4-7d2a-88bc-9ac3495ff5b8
title: "Build: adopting a CLI started in an operator shell as a harness thread"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0d591-22b7-7d97-a3f6-864267178e78",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0d56a-9916-7945-a5b9-62a47a4219f5
  - kind: waits-on
    to: 01a0d56a-99a9-7ac1-9410-7c033624e501
---
Build [[7a4219f5]] whole, in its order. Start at `HarnessSessions.drive` and `cli/hooks.ts`. Done when its acceptance holds end to end with a real `claude` in a panel shell, and the harness and hook suites pass.