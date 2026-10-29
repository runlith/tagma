---
id: 01a14c08-1c3f-7bde-a2e3-046576c9a0f3
title: Agent reads a page as an accessibility-tree snapshot with element links it acts on directly
ord: 2
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c08-1c3f-7bde-a2e3-046a6700af16
sources:
  - kind: file
    ref: apps/tagma/server/src/browser/engine/read.ts
  - kind: file
    ref: apps/tagma/server/src/browser/engine/refs.ts
---
**Value.** The agent understands a page as text, not as a picture, and acts on a found element at once: a snapshot is cheaper than a screenshot and gives stable links.

**How.** The `snapshot_page` operation — the accessibility tree of the main frame and all its frames as compact text, with each element carrying a link like `e12` that `act_on_page` and `capture_page` accept.

**Behaviour.**
- A node keeps its link across all later snapshots of the same document; a replaced document's link refuses with `stale-ref`.
- A snapshot reads up to `limit` lines and says the tree continues; part of it reads through `within` by link.
- Frames from another process (cross-origin iframes) enter the snapshot even while their connection is still being set up. Attachment completion waits at the frame-root read, and traversal includes same-process descendants discovered by that attachment while frame-root reads remain lazy.

**Limits.** Access to the operation matches [[4096201b|agent-driven pages]].
