---
id: 01a15417-b33a-7058-b932-71f3b7533052
title: runlith-law program judgement does not pay process start and full parse for a one-file edit
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15419-53a6-72a9-93e4-65b49c8d5d01",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a15417-4ea3-7cfd-8032-89c71b48552d
sources:
  - kind: dir
    ref: apps/tagma/server/src/enforcement/programs
  - kind: file
    ref: checks/law/programs.ts
---
Each judgement launches `bun checks/law/program.ts` for 8 rules and spends ~2.6 s even on a one-line edit; module loading alone is ~0.5 s. Sample what takes the rest. Remove it at the owner: in the program, in the call protocol, or in how the server calls it and what it caches. An effect-style violation in the changed file still refuses. Proof — a before/after sample.
