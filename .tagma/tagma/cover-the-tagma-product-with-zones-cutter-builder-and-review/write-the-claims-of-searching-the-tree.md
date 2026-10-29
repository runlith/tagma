---
id: 01a0ca85-8be9-75ab-867e-c9d7e68d057f
title: Write the claims of searching the tree
ord: 175
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
Write the claims of [[3c142bcc]] from the code, under parent [[3c142bcc]].

Read whole: `packages/agent-tools/src/glob.ts`, `packages/agent-tools/src/grep.ts`, `packages/agent-tools/src/search.ts`. Reference zones for precision (never size): [[d1caad35]] and [[13756ad0]].

Cover: the shared invocation envelope (binary, worker count, no-config) and why it is readable from the arguments; the page each tool answers; the stat concurrency bound; how ripgrep failures surface.

Done when: every claim is written from the code and verified, every symbol anchor resolves, `run_doctor` over the area's paths stands clean, and a review of the zone passes.
