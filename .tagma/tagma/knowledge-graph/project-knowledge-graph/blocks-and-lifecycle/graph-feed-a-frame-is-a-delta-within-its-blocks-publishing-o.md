---
id: 01a102ab-bd3a-757b-9ce3-0e335e29b5dc
title: "Graph feed: a frame is a delta within its blocks, publishing outside the act"
ord: 1
---
The commit hook only wakes the feed publisher (`graph/journal/feed.ts`): one fiber in the graph scope reads the journal from the watermark and sends frames. An act waits for neither frame reads nor subscribers, and no tree permit is held at publish.

`change` (`graph/contract/wire/feed.ts`) carries `blocks` — the event blocks and the blocks whose measured marks read them: `waits-on` sources to them, `implements` and `discovered-from` targets from them. `ready`, `trash`, `edges`, and `refs` describe state only within these blocks. The subscriber drops from its sets everything touching the frame's names — for trash also roots whose parent is among them — and applies what arrived. Its ready and trash then match a full recompute.

`resync` arrives instead of `change` when the vocabulary moves: some block is a tag or catalog declaration. It also arrives when the mirror rebuilt the graph with no journal events and when a frame could not be built. The subscriber then re-reads everything.

The client (`app/src/lib/features/graph/Feed.ts`) patches the `edges` and `refs` cache by the same rule and invalidates only the keys touching the frame's names.

Introduced by [[104d34eb]].
