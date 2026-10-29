---
id: 01a18906-5946-7cc1-afe1-26ad429018a5
title: A plugin's command hooks run at the agent's tool, step, close and thread points, and beforeTool can deny a call and rewrite its input
ord: 4
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: implements
    to: 01a184c6-16dd-744f-b710-46e663966472
  - kind: waits-on
    to: 01a18906-5946-7cc1-afe1-26aa0308018b
---
`beforeTool` carried guidance alone (`ToolAdmission.inspect` applies only `guide`), so the point gains a deny and an input rewrite of its own.