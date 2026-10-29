---
id: 01a10284-da13-7e0c-9742-a42bf6ae3465
title: list_agents, the compaction-boundary choice, and request-chain unwrapping from a trace cost O(answer)
ord: 30
tags: ["task"]
fields:
  {
    "holder": "tagma:01a10289-9e81-7d00-9d11-fe1fb9662b5c",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/store/directory.ts
  - kind: file
    ref: packages/agent/src/collaboration/CollaborationTools.ts
  - kind: file
    ref: packages/agent/src/collaboration/ThreadDirectory.ts
  - kind: file
    ref: packages/agent/src/thread/compaction/prefix.ts
  - kind: file
    ref: packages/trace-bundle/src/replay.ts
---
**What.** `list_agents`, the compaction-boundary choice, and unwrapping a model-request chain from a trace cost O(answer) or one pass, not O(everything).

**Why (perf audit 2026-10-03, from code).**
1. `list_agents(limit=20)`: `packages/agent/src/collaboration/CollaborationTools.ts:250-275` calls `directory.list()` without a limit; `ThreadDirectory.ts:70-142` reads through all inner pages of 200, counts `warmth` for everyone, then sorts and slices everything; `apps/tagma/server/src/threads/store/directory.ts:29-101` re-runs COUNT and sorting on every inner page. The next page repeats everything. Agents now number 556; the old `agent.directory 1ef12d3534991e42` sample is 4821 ms.
2. `packages/agent/src/thread/compaction/prefix.ts:31-47` calls `estimateThreadTokens(messages.slice(candidate, turn.end))` on every boundary — a full `JSON.stringify` of each tail, O(n²) over text (K4 in [[5610ee2b]]).
3. `packages/trace-bundle/src/replay.ts:635-681` recursively unwraps the `after` + delta chain: on every level `new Set(seen)` and `[...messages, ...payload.messages]` — O(s²).

**Direction.** The working/awaiting/idle order, cursor, and limit enter the directory and storage contract, warmth counts only for the selected page, the total stays honest. Message weights compute once, candidates walk suffix sums. The chain unwraps iteratively with one seen set and one concatenation; loop and unread-link checks stay.

**Done when.** `list_agents` with limit k materializes O(k) lines and counts no warmth outside the page, order and total as before; the compaction boundary matches the old one on the same inputs; the unwrapped request matches the old one.
