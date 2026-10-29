---
id: 01a0ca85-8bba-717a-81ec-13be04446920
title: Write the claims of running shell commands
ord: 172
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
Write the claims of [[2657028c]] from the code, under parent [[2657028c]].

Read whole: `packages/agent-tools/src/bash.ts`, `packages/agent-tools/src/CommandWork.ts`, `packages/agent-tools/src/commandClass.ts`, `packages/agent-tools/src/runtimeSpawner.ts`. Reference zones for precision (never size): [[d1caad35]] and [[13756ad0]].

Cover: the two roads (admitted work vs child of the call) and how the world decides between them; the preflight order (workdir, write-shape refusal, place, declared outputs); the lifecycle port's acceptance, observation and identity; what the class vocabulary covers and deliberately leaves out; what the spawner refuses rather than approximates.

Done when: every claim is written from the code and verified, every symbol anchor resolves, `run_doctor` over the area's paths stands clean, and a review of the zone passes.
