---
id: 01a16542-4df0-7de6-bc9f-183e6324930f
title: "A HEAD shift hands TypeScript only paths whose disk content diverged from the accepted snapshot: the base remembers blobs of paths that may differ from its HEAD"
ord: 11
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a1651e-ecba-7806-b331-17c0d5041faf
sources:
  - kind: file
    ref: packages/navigation-ts/src/engine/held.ts
  - kind: file
    ref: packages/navigation-ts/src/engine/workspace.ts
---
A commit never changes files, and checkout, reset, and rebase change only what git can name, so a HEAD shift never recomputes the whole snapshot: a full recompute reread every file and opened every checkout program on each agent commit, and warm-up then repeated the last questions on cold checkers.

For the base the engine remembers paths whose snapshot content may differ from the snapshot's HEAD, with the git blob id of the content the snapshot accepted: an observer path is hashed on intake, and at startup the differences of disk from HEAD are taken. Any path outside that set equals the HEAD blob in the snapshot. So on a shift from H0 to H1 the snapshot-disk divergence is searched only among the set's paths, the paths of `git diff H0 H1` (for them the snapshot holds the H0 blob), and disk-vs-H1 differences, and for each the disk blob is compared with the accepted one. A set path compares by raw bytes — what TypeScript read; a diff path by the blob git would count for the file on disk (`hash-object` with its filters and line endings): otherwise a file with `eol=crlf` would look changed on every shift. Before HEAD is born, every checkout file counts as differing from it, or the first commit would never have found what is already indexed. Without the set, a file changed at snapshot time and returned to the new HEAD's content would fall into no diff, and the snapshot would keep its edit. After a shift the set holds only paths differing from H1 — it never grows commit to commit. A shift with no divergence yields a new revision on the same TypeScript snapshot, and warm-up never repeats it.

On its own HEAD shift a worktree searches candidates the same way — its own differences from the base, the `git diff` of old and new HEAD, disk-vs-new-HEAD differences — and puts into the layer only paths whose difference from the base disk changed; its snapshot is never rederived from the base from scratch.

`CheckoutWatch` never watches directories git ignores wholesale (`node_modules`, `.svelte-kit`, `dist`): their arrival comes by rescanning, and changes inside never arrive. So the engine learns dependency changes from the lockfile: a base lockfile changed by content (a lockfile outside the set compares against its blob in HEAD) drops TypeScript file caches (`invalidateAll`), and marks closed programs stale without opening them, while a worktree with its own snapshot releases them. Such a base lockfile is accepted at once, without waiting for a question ([[61d1db53]]). A worktree recomputes its layer links when the lockfile content changes on it or on the base, and when its links exist or existed, rederives its snapshot from scratch: an updated package sits under the same link, and one link map cannot tell the new version apart. An install that never changes the lockfile (`bun install` after a `git pull` that changed the lockfile earlier) stays invisible until the next rescan. Full recompute with all programs open stays with the observer rescan — where the paths are truly unknown.
