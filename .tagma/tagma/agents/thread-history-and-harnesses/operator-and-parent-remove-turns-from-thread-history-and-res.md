---
id: 01a14bae-6720-7d62-897a-92846c655f6f
title: Operator and parent remove turns from thread history and restore what was rolled back
ord: 2
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-9283445ee8a6
  - kind: relates
    to: 01a14bae-6720-7d62-897a-9285e59adbe3
  - kind: supersedes
    to: 01a14b6d-b207-7c48-91ab-0627377b233c
sources:
  - kind: file
    ref: packages/agent/src/thread/rewind.ts
  - kind: file
    ref: packages/chat-ui/src/composerKeys.ts
  - kind: symbol
    ref: apps/tagma/app/src/lib/features/threads/native/strings.ts
    symbol: rewindWords
  - kind: symbol
    ref: apps/tagma/server/src/threads/contract/wire/operations/turns.ts
    symbol: TURN_OPERATIONS
  - kind: symbol
    ref: apps/tagma/server/src/threads/operations/turns.ts
    symbol: TURN_PAIRS
  - kind: symbol
    ref: packages/agent/src/collaboration/historyTools.ts
    symbol: historyTools
---
**Value.** A failed turn is removed from what the model sees, and restored if reconsidered: the thread goes on as if the turns never happened, while the feed remembers them.

**How.** Rewind and Drop turn on a message, the rollback picker in the composer; operations `rewind_thread`, `restore_thread`, `read_rewind`, `read_rewind_points`; for a parent — `rewind_agent`.

**Behaviour.** A running run stops first; the queue and unread words return as text, nothing starts on its own. What the rollback will remove and what it cannot return can be learned in advance. Files and the graph are untouched by rollback, but the operator can restore lines the thread itself wrote in the removed turns and never committed.

**Limits.** A rollback can be restored until one turn or one compaction has passed after it. A turn inside a summary cannot be removed. A terminal CLI does not take rollback; with Claude Code its vendor session does it. A thread outside its own subtree is rolled back by an agent only with the operator's consent.
