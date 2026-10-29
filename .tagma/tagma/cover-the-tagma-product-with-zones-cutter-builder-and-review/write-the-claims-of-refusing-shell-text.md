---
id: 01a0ca85-8bdf-7600-b6ee-f439c515e838
title: Write the claims of refusing shell text
ord: 174
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
Write the claims of [[4024d28f]] from the code, under parent [[4024d28f]].

Read whole: `packages/agent-tools/src/shellCommands.ts`, `packages/agent-tools/src/shellShapes.ts`. Reference zones for precision (never size): [[d1caad35]] and [[13756ad0]].

Cover: what the reader holds (quoting state, literal words, redirects, heredocs) and what makes a text unreadable; each write shape and what content it saves; the in-place option grammar; the Python operand reading; move tracking and the unreadable answer; each sweep shape and what bounds it; the wrapping limit.

Done when: every claim is written from the code and verified, every symbol anchor resolves, `run_doctor` over the area's paths stands clean, and a review of the zone passes.
