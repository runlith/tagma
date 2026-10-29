---
id: 01a14102-e0bd-706a-a397-ff2c8e2e2049
title: "Build the thread context limit: a server owner, the wire, feeds, the agent directory, chat, and the app"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13ae5-4e4c-705e-bf50-2c2b1f52d4e9",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a14102-d13a-7421-b8b7-dd74132e596c
---
Implement the whole [[132e596c|spec]]. Start with the core (`compaction/limit`) and `ServedModel.plannedOutputTokens`, then the `native-harness/compaction/limits.ts` owner and the `ContextLimits` port, the wire and feeds, the directory, chat, and the app. Done when the spec's "what the performer proves" holds.
