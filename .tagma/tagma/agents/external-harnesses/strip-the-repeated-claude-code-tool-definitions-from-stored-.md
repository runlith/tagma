---
id: 01a0f967-da02-7585-9bfe-9aef2b875d3d
title: Strip the repeated Claude Code tool definitions from stored thread messages and reclaim their space
ord: 174
tags: ["task"]
fields:
  {
    "status": "closed"
  }
---
Since a1bcbf3dd3, [[81ea5578|a receipt carries the deferred definitions only where they change]]. Everything stored before it still carries the lane's whole accumulated set (~140–150 KB of schemas) on every Claude assistant message. Those copies are correct to read and need no rewrite for correctness, but every long Claude thread keeps paying for them on each history read, metering pass, worker handoff and trace payload, and in disk.

Measured on thread 01a0f450 (law-opus): a 69.9 MB model request carried 66.7 MB of these copies; its `thread_event` rows of kind `step` hold 96 MB, 822 of 2534 carrying `toolDefinitions`. `thread_history_item` holds 274k rows over 1852 threads; a full scan of it did not finish in 55 s, so the share it carries is unmeasured. Rested threads keep the same messages in rollout files of up to 660 MB.

What to do: in every stored form a history is rebuilt from — `thread_history_item.message`, the messages inside `thread_event` payloads, rollout files — drop `toolDefinitions` and `inventory` from each `native.claudeCode` receipt whose pair equals the previous carrying receipt of the same `key` in that thread, in history order, compared as canonical JSON exactly as `ClaudeCodeState` compares them. Then reclaim the freed pages.

Constraints:
- Must not hold the server's boot or a writer for minutes: run in bounded units the server drives, or as an explicit maintenance operation the operator starts.
- Whether the event log may be rewritten in place is the record owner's decision ([[fc9c26d8]]); settle it before touching `thread_event`.
- Reclaiming a ~70 GB file needs free disk of the same order; measure before choosing VACUUM or incremental reclaim.

Done when: a heavy thread's stored history holds definitions only on its carrier receipts, its restored request declares the same tools as before the rewrite, and the before/after sizes of the touched tables and rollouts are measured.
