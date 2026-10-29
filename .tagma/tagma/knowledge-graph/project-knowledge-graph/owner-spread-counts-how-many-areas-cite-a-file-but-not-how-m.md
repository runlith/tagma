---
id: 01a0c99a-9f09-7fff-aa2b-27ae976d54ac
title: owner-spread counts how many areas cite a file but not how much each one owns, so a file with one dominant owner and four single citations reads as ownerless
ord: 179
tags: ["reflection"]
fields:
  {
    "actual": "All eight standing owner-spread findings have one dominant owner and a tail of single citations: anthropic-messages.ts 28 claims vs four areas with 1 each; ClaudeCodePresentation.ts 20 vs 1,1,1,1; shared.ts 17 vs 2,1,1,1; AgentToolDoor.ts 16 vs 1,1,1,1; executor.ts 12 vs 3,3,3,1,1; AgentHarness.ts 9 vs 1,1,1,1; errands.ts 7 vs 2,2,1,1. Only ExecutionRegistry.ts#spawn is genuinely spread, at 2,1,1,1,1,1,1. The check fires the same way in three packages cut by three different sessions.",
    "command": "run_doctor over packages/agent, then read_findings check=owner-spread across the project",
    "expected": "A file flagged as owner-spread is one no area decides the shape of — several areas each holding a comparable share of it, so a reader cannot tell who owns the code"
  }
---
Filed from project `runlith`.

The finding's own remedy text assumes the spread case: "code of several areas in one file is SPLIT between them; one mechanism several areas describe means moving the source that points at the consumer's side." Neither applies to a file where one area holds sixteen claims and four others hold one apiece — nothing is split, and the consumer-side sources are already on the consumer's side. The dominant owner does decide the shape; the others are citing the file because it is where their own sentence is decided.

What makes this worth reporting rather than absorbing is that the honest response conflicts with another instruction the same wave enforces. Three reviews in this zone returned UNSUPPORTED on bodies resting on comments, and the repair in each case was to bind the narrow evidence that could contradict the claim — which lives in the shared file. So satisfying the review raised the owner count, and satisfying owner-spread would mean unbinding evidence the claim needs. The finding says NEVER silence it by dropping a claim, and weakening a source is the same act in a thinner disguise, so the finding is left standing with a written reason instead.

A weighted reading would separate the two cases without losing the real one. If the check compared the dominant owner's share against the rest — flagging where no owner holds a clear majority, as ExecutionRegistry.ts genuinely does not — it would still catch the file nobody decides, and stop firing on the file many areas legitimately cite. As it stands, a session that takes the finding at its word will either unbind good evidence or split a cohesive file, and both make the graph worse.

Measured while covering packages/agent for decision a014cd4c; the counts above are from one read of the standing queue.