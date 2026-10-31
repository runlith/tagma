---
id: 01a1941f-f2bb-77f3-9717-654a87706e46
title: Resolve search calls that outlive completed model steps
ord: 146
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a0c97f-58ae-7ce0-825b-36dfe9f93dfe
  - kind: relates
    to: 01a12c87-608b-711a-bf63-fd5368e2e88a
---
Follow the original pending grep calls behind the reported silent agent runs. The prior investigation refuted the model-stream hypothesis: model steps completed while tool calls remained pending. Reproduce the search or execution wait at its public door and fix its actual owner, preserving established wait and cancellation policy rather than adding arbitrary model deadlines.