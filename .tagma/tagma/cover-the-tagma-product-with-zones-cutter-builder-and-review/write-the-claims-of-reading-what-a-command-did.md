---
id: 01a0ca85-8bd9-7751-a2d2-4e26f540ec95
title: Write the claims of reading what a command did
ord: 173
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0ca86-8e4d-71d5-83ad-79c00edba7e8",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0ca85-8b21-7009-8bcc-eddc5565be05
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
---
Write the claims of [[1a4da3ba]] from the code, under parent [[1a4da3ba]].

Read whole: `packages/agent-tools/src/ShellRun.ts`, `packages/agent-tools/src/CheckoutBaselines.ts`, `packages/agent-tools/src/outputs.ts`. Reference zones for precision (never size): [[d1caad35]] and [[13756ad0]].

Cover: why the observation is a value in the command's scope rather than a stretch of the tool body; the rings, the window and the ending it settles; how movement is measured and what it cannot see (untracked-and-ignored, nested clones); the baseline ownership and the overlap rule; declared outputs and their pre-read refusals; what an interrupted observation reports.

Done when: every claim is written from the code and verified, every symbol anchor resolves, `run_doctor` over the area's paths stands clean, and a review of the zone passes.
