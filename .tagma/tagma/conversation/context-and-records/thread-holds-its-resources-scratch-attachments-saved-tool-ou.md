---
id: 01a14bc0-7671-7bdb-92a9-e696a4e069a4
title: Thread holds its resources — scratch, attachments, saved tool output, terminals, rollout — and releases them on deletion
ord: 7
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-9288c2f9fd4b
sources:
  - kind: dir
    ref: apps/tagma/server/src/threads/resources/kinds
  - kind: file
    ref: apps/tagma/server/src/native-harness/resources/evidenceReads.ts
  - kind: file
    ref: apps/tagma/server/src/threads/resources/hold.ts
  - kind: file
    ref: packages/agent/src/resources/resourcesToolSources.ts
  - kind: symbol
    ref: apps/tagma/server/src/threads/contract/wire/snapshot.ts
    symbol: threadHeldSchema
---
**Value.** The operator and the agent himself see what is durably recorded for a thread — scratch, attachments, saved output, terminals, rollout — and what will be freed with it.

**How.** The operator — the `read_thread_held` operation; the agent — the `held_resources` tool (deferred) about his own thread.

**Behaviour.** Every row names the resource kind, what it holds, and when taken. Deleting the thread frees everything; unloading an idle thread frees only scratch and saved tool output.

**Limits.** A thread with managed runs or terminal operations without an outcome cannot be deleted until custody passes or the runs stop (A6).
