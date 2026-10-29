---
id: 01a14bae-6720-7d62-897a-9285e59adbe3
title: Operator and parent compact a thread's context; the operator decides who writes the summary and whose quota pays
ord: 3
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: supersedes
    to: 01a14b6d-b20b-7df8-967f-12f6ca207c5e
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/ModelPanel.svelte
  - kind: file
    ref: apps/tagma/server/src/native-harness/contract/wire/compactionSettings.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/contract/wire/operations/context.ts
  - kind: file
    ref: apps/tagma/server/src/threads/cli/turnVerbs.ts
  - kind: symbol
    ref: apps/tagma/server/src/native-harness/contract/wire/operations/compaction.ts
    symbol: COMPACTION_OPERATIONS
  - kind: symbol
    ref: packages/agent/src/collaboration/CollaborationTools.ts
    symbol: collaborationTools
  - kind: symbol
    ref: packages/agent/src/collaboration/collaborationVerbs.ts
    symbol: COMPACT_OUTCOMES
---
**Value.** A long thread keeps working in a short window, while the operator decides which model writes the summary and whose quota pays — compaction does not silently spend an expensive model.

**How.** `/compact` and the compaction model picker in the composer, the `compact_thread` operation, `tagma compact`; for a parent — `compact_agent` and `send_task` with compaction; `read_compaction_choices` shows the choice and price in advance; the summarizer chain and rule are settings.

**Behaviour.** A running thread compacts at a step boundary or after the turn. The thread's model, the first available member of the operator's chain, or nobody writes the summary — then compaction refuses instead of spending the thread's model. What the summary must keep can be named. Claude Code compacts with its own model in the vendor session; another model retells the journal, and the next turn opens a new session. An assignment with compaction stands right behind it and opens even when compaction failed.

**Limits.** A terminal CLI does not compact. An assignment with compaction goes to one descendant.
