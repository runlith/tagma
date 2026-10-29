---
id: 01a14bc5-0df5-77c8-b1a2-694b05354451
title: An agent's graph acts show in the thread feed as block cards, and writes show a diff of what the call changed
ord: 5
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-69423f034f23
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-69438e883daf
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/BlockCard.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/BlockRefText.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/graphTools.feed.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/ToolBlockDiff.svelte
  - kind: file
    ref: apps/tagma/server/src/graph/voice/display.ts
---
**Value.** Watching the agent, the operator sees which blocks it read and exactly what it changed in the graph, right in the thread feed, without opening the graph.

**How.** Graph-operation answers in a native thread's feed; the feed itself is run by the "Conversation and attention" area.

**Behaviour.**
- Read and found blocks show as cards.
- A write shows as a card with a diff of exactly what that call changed. A step that wrote a title or body (`create_block`, `edit_block`, `update_block` with `title`, `body`, or `bodyFile`) opens by itself, like a file `edit` and `write`; status moves, moves, fields, and sources stay collapsed. The card links to the block by the general rule: a click opens the block as a right-side tab while the thread stays on screen; ⌘-click as a Knowledge page in a diff lens over the same range; right-click gives the link menu.
- A refusal shows as the agent saw it.
- Block and thread references in an answer's text show with live titles. Another project's block opens in its own copy.
- A write or read card takes the block address from the operation answer and opens at once.

**Limits.** A list card and an answer card for an earlier write without a branch address take the address from a name lookup and open the block once it answered.
