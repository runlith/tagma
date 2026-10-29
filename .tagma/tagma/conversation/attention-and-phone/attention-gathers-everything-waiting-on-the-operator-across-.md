---
id: 01a14bc0-7696-71f4-8eeb-ff1e8a780ecb
title: "\"Attention\" gathers everything waiting on the operator across all projects in one list: agent questions, crashed and finished runs, plugin notices"
ord: 1
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-9286739b512c
  - kind: relates
    to: 01a14bc0-76bc-7bce-a3ea-c23dafb820dc
  - kind: relates
    to: 01a14bc0-76c7-7595-a09a-82c02494791d
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/attention/Attention.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/app/attention/AttentionButton.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/app/attention/rows.ts
  - kind: file
    ref: apps/tagma/server/src/threads/contract/wire/attention.ts
  - kind: file
    ref: apps/tagma/server/src/threads/contract/wire/operations/attention.ts
  - kind: file
    ref: apps/tagma/server/src/threads/list/attention.ts
  - kind: file
    ref: apps/tagma/server/src/threads/operations/attention.ts
  - kind: symbol
    ref: apps/tagma/server/src/threads/events/standing.ts
    symbol: standingOf
---
**Value.** An operator with several projects and dozens of agents does not walk threads one by one: everything waiting on him — questions, crashed and finished runs, plugin notices — sits in one list.

**How.** A bell in the top bar with the waiting count; on the phone — the Inbox tab. The `read_attention` and `mark_thread_seen` operations. `read_attention` is also read by an agent — as a deferred tool of a native agent or through a CLI thread's MCP operation — with the same answer; an agent's reading does not mark threads seen, `mark_thread_seen` belongs to the operator alone.

**Behaviour.**
- A thread enters the list when it waits on the operator's answer (including approval), when its run crashed or was cut and is unseen — a child's too — or when a root thread finished. A child's question that a parent agent answers by routing does not land here; it appears when it passes to the operator: on interception, child detachment, grant change, or when the parent goes to archive while the child stays. A child's end reaches the parent as a report and does not land here.
- The list groups waiting, crashed, and finished, with plugin notices above them; all projects or the current one can be watched. A click opens the thread.
- A thread open on screen marks itself seen; "mark all" clears crashed and finished ones.

**Limits.** On desktop a question cannot be answered from the list — only by going to the thread; short options are answered right in the phone's Inbox. Archived threads never enter the list.
