---
id: 01a14c14-6895-75c6-80f2-47b2ec9cf08a
title: "It is visible who holds the terminal: the operator takes it from the agent in one act, and the agent passes it to another thread or the operator"
ord: 5
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-9288c2f9fd4b
  - kind: relates
    to: 01a14bae-6720-7d62-897a-929026c9986a
  - kind: relates
    to: 01a14bc0-7671-7bdb-92a9-e696a4e069a4
  - kind: relates
    to: 01a14c14-6895-75c6-80f2-47b3a24c4397
  - kind: relates
    to: 01a14c14-6895-75c6-80f2-47b5276a0943
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/executions/terminal/PaneTitle.svelte
  - kind: file
    ref: apps/tagma/server/src/executions/terminals/custody.ts
  - kind: file
    ref: apps/tagma/server/src/threads/resources/kinds/terminal.ts
  - kind: symbol
    ref: apps/tagma/server/src/executions/terminals/lanes.ts
    symbol: refuseThreadView
---
**Value.** Every execution has exactly one holder answering for it, and the operator can always intervene without stopping the work.

**How.** The panel header names the holding agent; "Take Over from …" in the panel context menu and the button in the CLI thread (`take_over_terminal`); the agent's `transfer_terminal`.

**Behaviour.**
- Typing into the execution needs no custody: every writer has its own lane. The operator also types into the agent's terminal; the agent types only into what it holds, and first takes another's terminal over on the operator's word.
- Handover ends every lane that typed into the execution — the right to type does not pass with the handover; the process and its resources are untouched.
- Every act resolves over the custody revision the caller saw: a changed revision refuses instead of landing in the wrong place. While a handover outcome is unknown, both threads are fenced from deletion.
- Terminal readings name to the agent who else typed into the execution and when.

**Limits.** Handover does not leave the project: the recipient is a live thread of the same project or the operator. A thread holding executions cannot be deleted until they are passed or stopped. The operator lane and Take over are acts of the operator window; the thread does not call them.
