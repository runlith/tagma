---
id: 01a14bae-6720-7d62-897a-92794b55f4da
title: Agents write to each other and assign tasks by team name or thread id, to one recipient or several at once
ord: 3
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-927b5e810ef5
  - kind: relates
    to: 01a14bae-6720-7d62-897a-9285e59adbe3
  - kind: supersedes
    to: 01a14b6d-b1e1-73b9-a839-ccd1423cdc33
sources:
  - kind: file
    ref: packages/agent/src/collaboration/envelopeActs.ts
  - kind: file
    ref: packages/agent/src/collaboration/ThreadEnvelopes.ts
  - kind: symbol
    ref: apps/tagma/server/src/threads/operations/collaboration.ts
    symbol: COLLABORATION_PAIRS
  - kind: symbol
    ref: packages/agent/src/collaboration/collaborationVerbs.ts
    symbol: sendMessageInput
  - kind: symbol
    ref: packages/agent/src/collaboration/collaborationVerbs.ts
    symbol: taskInput
  - kind: symbol
    ref: packages/agent/src/collaboration/sendTools.ts
    symbol: sendTools
---
**Value.** Agents of a team agree and hand work to each other directly, with no operator in the middle; an assignment differs from a message in that an answer is due for it.

**How.** The `send_message` and `send_task` tools; the same-named operations for threads of other CLIs.

**Behaviour.** The address is a name within the sender's team or a thread id: by id any thread of the owner on the server is reached, in another team and another project. One word goes to several recipients, and each sees it once. A working agent reads a message at its next step, never mid-way through a long call; an assignment stands behind its current turn; an idler starts a turn at once. Agent messages do not interrupt a tool wait; only the operator's words and a report that is owed do. In the recipient's feed an agent's word stands in the same bubble as the operator's word, with the sender's name — a link to its thread in its home project, wherever the recipient stands — and a view when it is not a plain message ("Assignment from …", "Report from …"); a child's birth task is shown the same way, as coming from the parent. A turn opened by an agent's assignment or interrupt is rolled back and branched like the operator's own.

**Limits.** At least one unknown address — the word goes to nobody. In review mode the operator confirms every send.
