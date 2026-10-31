---
id: 01a14c78-913b-7012-a67a-5f5094d69020
title: A live tree refresh reads status over paths named since the last refresh, and whole only when they cannot tell the rest's status
ord: 9
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a14c68-7621-72a2-934f-b3d113fa5d17
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/serving/freshness.ts
  - kind: symbol
    ref: apps/tagma/server/src/graph/tree/freshness.ts
    symbol: treeSeen
---
The freshness gate accumulates paths the tree watcher named since the last refresh, and refresh reads `git status` only over them; it takes the remaining dirty paths from the previous read. Tagma's own writes' echoes count as named too: they never wake a refresh but join the set — otherwise the dirty paths receiving `batches.carry` and the stamp comparison would diverge from a full status. With the cost ledger mounted, each background refresh opens its own root rather than inheriting the act that registered the long-lived tree runtime.

If HEAD moved since the last read, paths from the old HEAD vs new `diff` are re-read too: a commit, reset, or checkout changes the status of files nobody touched. With no named paths and no HEAD move, status is not read at all.

The tree reads whole when the named paths cannot tell the rest's status:
- the first read with no stored basis (how it reads after a restart is told by [[ec0b8911]]), any watcher rescan (`unnamed`, `opened`, `lost`, `error`, `polling`), a call with no standing watch, and `settled(force)`: events may never have existed or not arrived yet — `rewrite_graph_files`, landing, and conflict resolution read the tree right after writing to disk;
- a failed or interrupted refresh: the paths it took are half-read;
- the previous HEAD no longer reads as a commit;
- ignore rules changed: a `.gitignore` or the root itself is among the paths, or rule files outside the tree stat differently than at the last read;
- the paths do not fit one command line (the git-kit limit).

At a twin tree the watcher also looks at the project checkout's git directory. git writes `refs/heads/*`, `logs/HEAD`, and `index` through lock and rename, and such an event arrives as a `rename` rescan with the file named. That is no event loss: a `HEAD` or ref rename is the same topology movement as a plain `head`, and the narrowed tree scope survives; a project `index` rename never wakes refresh — the graph tree's status reads the shadow repository's index. Otherwise every project commit produced a full tree status and two topology reads. Topology movement arriving before a running refresh has read topology is covered by that refresh.

The gate reopens lost watching itself: after 2 s, then doubling the pause up to a minute, while the tree stays registered. Without that every act before re-registration would read the whole tree; watching returns as `opened` and yields one full read.

Rule files outside the tree are the repository directories' `.gitignore` files above the tree, the shared git directory's `info/exclude` and `config`, and the excludes file the server's own git reads (the repository's `core.excludesFile`, else `$XDG_CONFIG_HOME/git/ignore` or `~/.config/git/ignore`). The tree watcher never sees them: at a team tree it looks only at the tree directory. So a full read records their stat, and a scoped read checks it first — a few `stat` calls instead of a subscription per such file. A full read re-asks git for the excludes-file path only when the shared git directory's `config` or the tree's `config.worktree` stat changed: without global and system config it depends only on them. If they hold `[include]` or `[includeIf]`, the path reads on every full read: this stat never sees the included file and the branch condition. The list and stat are taken before status: an edit between them is visible to the next read.
