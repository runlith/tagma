---
id: 01a19578-7e70-7ca7-ba04-4194cdc3f56c
title: Background child compaction fails a span-parent invariant
ord: 150
tags: ["reflection"]
fields:
  {
    "actual": "The background execution failed with “Span agent.directory opened under run, which the schema forbids”; no compaction outcome was delivered.",
    "command": "compact_agent({threadId:\"01a1951f-1b90-7954-b93e-8db843207dfa\",keep:\"Next potential review is a separate delivery: a true pooled-reader SQLite read snapshot…\",background:true})",
    "expected": "Compact the idle reviewer and report the summarizer and retained context, or return a typed refusal."
  }
---
Filed from project `tagma`. Received by a server up since 2026-11-01T04:35:00.962Z, from b555dcaa0.

The call was accepted as run 01a19564-6d3e-71e7-b653-9c7136205320 / call_90177f00a8224a98a56e0075f08e90d3, then failed in agent/spans.ts:86 through ToolExecution.attend and AgentTurn.runStepTools. This was an execution failure, not a graph refusal; the reviewer’s current state remains unproved.