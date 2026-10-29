---
id: 01a10284-da13-7e0c-9742-a427104d34eb
title: The graph feed is published outside permits and carries a delta; the client invalidates only what was touched
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a10289-9e81-7d00-9d11-fe214ba46384",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/Feed.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/ProjectTree.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/spatial/GraphView.svelte
  - kind: file
    ref: apps/tagma/server/src/graph/acts/unit.ts
  - kind: file
    ref: apps/tagma/server/src/graph/contract/wire/feed.ts
  - kind: file
    ref: apps/tagma/server/src/graph/journal/feed.ts
---
**What.** The graph feed is published after permits are released, outside the calling latency, and carries a delta; the client applies the delta and invalidates only what was touched.

**Why (perf audit 2026-10-03).**
- `graph/journal/feed.ts:119-165` (`publish`) on every act with any subscriber recomputes the project's whole ready frontier (`selection.ready({projectId})`) and `trash.roots(projectId)`. Called from `acts/unit.ts:84-89` on onCommit inside `floor.guard`: the tree permit is still held, the calling transaction has not returned. Measured: `edit_block 9dfbeb2402bf6838` (2026-10-01, instance 8dfcca12) — 7037 ms, of which `Selection.ready` is 6241 ms with the transaction itself at 565 ms. Everyone waiting on the tree permit also waits on the feed.
- The frame (`graph/contract/wire/feed.ts:11-21`) carries full ready and trash lists. On every frame the client: `features/graph/Feed.ts:57-61` invalidates all BlocksRepo/JournalRepo/SessionsRepo; `spatial/GraphView.svelte:60-78` re-reads the project's whole `read_edges` and `read_refs`; `ProjectTree.svelte.ts:52-69,129-131` rebuilds and sorts all siblings — O(B log B) at ~10k blocks. Act.written is ~1.3 per minute in ordinary work, dozens in batch sessions.

**Direction.** Publish after permits with watermark order kept; ready and trash are computed as a delta over touched blocks and their waits-on/implements-dependent blocks; the frame carries changed blocks, edges, refs, and the ready/trash delta; the client invalidates queries only by the touched blocks' keys and keeps `childrenByParent` by parent. The frame's producer and consumer change together.

**Done when.** A write act does not hold a permit for publish time and does not compute the whole project's ready; the frame carries a delta; the open map and outline do not re-read the project on someone else's write; the subscriber's ready and trash match a full recompute (feed-contract test).
