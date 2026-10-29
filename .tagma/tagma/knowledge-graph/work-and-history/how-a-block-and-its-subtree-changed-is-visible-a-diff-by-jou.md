---
id: 01a14bc5-0df5-77c8-b1a2-69438e883daf
title: "How a block and its subtree changed is visible: a diff by journal and a \"what changed since last read\" lens"
ord: 7
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-69423f034f23
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-6947519b9f89
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-6948b2fd65e7
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/BlockDiffCard.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/diff.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/DiffBox.svelte
  - kind: symbol
    ref: apps/tagma/app/src/lib/features/graph/ReadState.svelte.ts
    symbol: ReadState
  - kind: symbol
    ref: apps/tagma/server/src/graph/blocks/bodyDiff.ts
    symbol: bodyDelta
  - kind: symbol
    ref: apps/tagma/server/src/graph/blocks/history.ts
    symbol: historyLayer
---
**Value.** Returning to a block, the operator sees at once what changed in it and its subtree since he last read it, and who did it. No full reread is needed.

**How.** `read_block_diff` — from a seen state or between two journal points. In the app — the diff lens on the block page; journal links and feed cards open it for a change to a block that already stood, while a creation opens the block itself.

**Behaviour.**
- The diff shows the body with insertions and deletions, title, status, and tag changes, lists the rest, and marks creation, deletion, restore, move, and edit in the subtree. A block born inside the range has no earlier body to mark against, so its body stands plain; the creation itself stands in the ops and the marks.
- When an agent changes an open block, the page itself switches to the lens from that edit. The operator's own edits never turn it on.
- Read marks live in the browser; outline highlights rows updated since last open.
- In the feed a block edit shows in a fixed-height window that opens at once on the first edit, from the start of its paragraph rather than the body's top. On the window's right edge stand marks of every edit by its place in the body: green for insertion, red for deletion, blue for replacement; pressing a mark scrolls to the edit. The window stops scrolling itself as soon as the reader scrolled it.

**Limits.** For edits made before the journal started keeping a body delta, the diff says only that the body was rewritten. The diff also reads for a block in the trash.
