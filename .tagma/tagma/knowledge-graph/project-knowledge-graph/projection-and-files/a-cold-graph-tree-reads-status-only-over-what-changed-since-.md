---
id: 01a14ccf-a748-70e7-824c-c0a8ec0b8911
title: A cold graph tree reads status only over what changed since the watcher mark the mirror basis saved before its own read
ord: 7
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a14c3d-ab9b-7368-9676-3720a6b4b6b7
  - kind: relates
    to: 01a14c78-913b-7012-a67a-5f5094d69020
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/serving/freshness.ts
  - kind: file
    ref: apps/tagma/server/src/graph/tree/stamp.ts
---
After every refresh the mirror stores a basis (`tree-basis` in `meta`): the HEAD, the dirty paths and the stat of this read's ignore-rule files, plus the watcher mark — an opaque position from `FileWatcher.mark`. The registration's first refresh — after a server restart or graph reopen — asks `changedSince(mark)`. If the watcher vouches, status reads only over the changed paths and the previously dirty ones; added to them are paths where the index differs from HEAD (`diff-index --cached`) and paths from the old HEAD vs new diff. If it does not vouch — the tree reads whole.

Why these paths suffice: a path clean at the last read turns dirty only if the working file changed (the watcher names it), the index (`diff-index`), or the HEAD at that path (the HEADs' diff) changed. `diff-index` runs only on a cold read: a live tree never watches the index, and anything could have passed while there was no server.

The mark invariant: every change before the mark is included in what the basis read saw. A path-scoped read covers only its own paths, so refresh takes the mark before draining the accumulated named paths. The process cursor answers `mark` after yielding all events before itself on the same channel, and by drain time they are already among the named. Taking the mark after the drain would leave a change between drain and mark in neither this read nor the mark, and it would be lost after a restart. Events after the mark arrive again, harmlessly.

The snapshot goes into one of three files beside the mirror (`.watch-0`…`.watch-2`), always one neither the basis mark nor the spare references. If refresh crashes after the mark, both basis files stay intact. A cheap mark works the same: the watcher writes the snapshot or not, and the core never substitutes a file the basis references. Where a snapshot is expensive (`marking: 'close'`, the snapshot is a tree walk), a plain refresh takes a cheap mark — the process cursor only — and the basis keeps the last snapshotted mark as the spare (`fallback`). It is asked when the cursor does not vouch. Graph closing takes a snapshotted mark before the tree permits its disposal holds: otherwise the last refresh would await a permit held by the closer itself. An older mark yields a superset of changes, which is equally correct.

Which source answers for the mark — the watch process cursor, the FSEvents journal with volume-UUID check, or a brute-force snapshot — the watcher decides in one call, and the core never branches by OS.
