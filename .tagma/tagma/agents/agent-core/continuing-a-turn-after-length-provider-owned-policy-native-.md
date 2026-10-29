---
id: 01a14743-437b-7fd2-9482-3351cc910981
title: "Continuing a turn after length: provider-owned policy, native max_tokens capture, and partial tool input preservation"
ord: 62
tags: ["task"]
fields:
  {
    "holder": "tagma:01a168d1-1a33-75b6-ae98-08fea2b63cb8",
    "status": "done"
  }
sources:
  - kind: file
    ref: packages/agent/src/agent/AgentTurn.ts
---
Fix the native run stopping after the first length: the model profile contract must define the semantics of continuing a finished response, the kernel must preserve partial output, never execute an unfinished tool input, and apply a bounded policy. Start with the maintained max_tokens fault capture of Claude Code 2.1.284/SDK 0.3.284 and request replay. Verify text-only, thinking-only, partial tool input, and exhaustion through a public run, keep the 32000 wire cap for Haiku until new native measurements. A typed ending must keep modelStarted and the condition instead of a plain Error with unknown diagnostics; transport retry and turn continuation remain different outcomes.
