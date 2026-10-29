---
id: 01a16a05-c379-783b-b4bd-0d40646a9782
title: "The worktree mark is a muted-colour diamond: squares in its row already mean state"
ord: 7
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a165b3-4050-7292-999c-e1cf18dd9e6b
  - kind: relates
    to: 01a165d5-d5a5-785f-bfe2-a3acf0e82349
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/worktrees/tone.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/worktrees/WorktreeSwatch.svelte
---
In the worktree row and in thread rows under it, squares are already taken: the thread-state tile and the "waiting", "working", "crashed" agent-counter tiles (`AgentCounts`). A square worktree mark would have merged with them in a narrow column where a worktree has five working child agents. A diamond is the same sign tile, rotated like the crest tiles, so it stays in Tagma's language and does not read as state. A triangle was rejected: in the worktree chip a contoured ⚠ of the last action's refusal stands next to the mark. The Git branch icon was rejected: on a 1 px line six muted colours nearly merge, and its drawing repeats the Checkout icon on the rail.

A diamond's fill means the worktree exists. The colour is the worktree's own, for one Tagma created. Worktrees made with `git worktree add` outside Tagma have no own colour and are painted in muted text. Main is a muted contoured diamond with a filled core: filled grey would have matched someone else's worktree, and an empty contour would have stood next to the "none" dashes. An empty dashed diamond (`row={null}`) is a worktree that is gone: still being created, deleted, or the thread stands in none. Detached is not in the mark: it is HEAD state, it happens to any kind and is named in words next to it.

`--worktree-0…5` follow the same condition as project colours ([[f0e82349]]): saturation 0.06 in the dark theme and 0.07 in the light one, and no closer than 21° to any state tone. The previous colours (0.10–0.16) stood next to them in tone, and the mark argued with the "ready" and "conflicts" words in the same row. Free tones are few, so the six colours differ weakly. That is tolerable: the worktree name always stands next to the mark or opens in a tooltip.
