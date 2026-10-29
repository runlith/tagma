---
id: 01a14bc0-7660-7057-8507-468f3ccccf91
title: Old tool output is cleaned from the request when fresh output outgrows its window share
ord: 4
tags: ["feature"]
fields:
  {
    "state": "live"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/compaction/policy.ts
  - kind: file
    ref: packages/agent/src/thread/compaction/prune.ts
  - kind: symbol
    ref: apps/tagma/server/src/native-harness/contract/wire/settings.ts
    symbol: toolOutputShare
---
**Value.** A thread that reads a lot through tools neither hits the window nor goes to compaction early: old output leaves the request, fresh output stays.

**How.** By itself; the window share for output is the `agent.toolOutputShare` setting; state is visible in the context ring panel.

**Behaviour.** Tool output from the operator's latest turns is never touched. Older than that, the server keeps the freshest output within the window share and replaces older results in the request with a cleanup line. Call and arguments stay; the model request changes, not the feed. Images from tool answers are cleaned by their own budget.

**Limits.** Lowering the share on a live thread can clean output inside the warm prefix and drop the prompt cache.

When cleanup is not enough, the next step is [[e59ad3e3|compaction]]; the full text of a long answer is not lost: [[75f9fb06|saved output]] keeps it.
