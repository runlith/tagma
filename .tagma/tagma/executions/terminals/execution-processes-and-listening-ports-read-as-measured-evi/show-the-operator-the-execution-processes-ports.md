---
id: 01a14c37-8e77-78ef-b4cc-eda05760ad61
title: Show the operator the execution processes' ports
ord: 1
tags: ["idea"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a14c14-6895-75c6-80f2-47b678492cb5
---
The window already computes `ProcessLine.ports` (`features/executions/commands/Activity.svelte.ts`), the agent reads them, but no operator screen draws them.
