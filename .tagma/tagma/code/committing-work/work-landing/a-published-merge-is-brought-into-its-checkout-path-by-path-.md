---
id: 01a1965a-6add-7ae0-930b-23f14b77c062
title: "A published merge is brought into its checkout path by path: a path holding uncommitted work keeps its file and alone stays unsynced"
ord: 188
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a19654-b900-7dd2-9ee1-92bd7f8ab4de
sources:
  - kind: file
    ref: apps/tagma/server/src/landing/land/bring.ts
---
`merge_worktree` and the pull merge move the checkout only after the commit is published, and another session may write one of the merge's paths after admission. `read-tree -m -u` is all or nothing. The first try is still one `read-tree -m -u`, and only its refusal takes the narrow road:

- **Before this.** One such path left the index and every file on the old tree while HEAD stood on the merge, so the next commit from the checkout would silently revert the merge.
- **Kept paths.** The paths git would overwrite are the merge's paths whose index or file differs from the old tree, plus paths the merge adds that already stand on disk. A path flagged assume-unchanged or skip-worktree is judged by its file's hash: `diff-index` trusts those flags, while `read-tree` checks the real file.
- **File↔directory transitions.** If a kept path lies where the merge turns a file into a directory or back, nothing is narrowed: a single index entry cannot stand for that move.
- **Narrowed tree.** A tree equal to the merge except at those paths is built in a temporary index, and the checkout is brought to it. Git's two-way rule keeps a path that is equal on both sides as it stands.
- **Index of a kept path.** It is set to the merge unless that work was staged, so the work reads as an unstaged edit against the merge rather than a staged revert. Staged work is left in the index, because overwriting it would lose it. The write goes through the held-index settle under git's `index.lock`, and it replaces only an entry that still stands at the old tree, so a `git add` made meanwhile survives.
- **Temporary index.** Its commands run with `core.splitIndex` and `core.fsmonitor` off, so the temporary index leaves no `sharedindex` file behind.
- **Answer.** Only the kept paths are named in `unsynced`. A checkout git refuses even then is named whole and left as it was.