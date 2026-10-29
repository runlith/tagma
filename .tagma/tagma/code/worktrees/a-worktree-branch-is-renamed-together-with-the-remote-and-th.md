---
id: 01a14c13-c481-7acc-8aa6-03cf5e92d5db
title: A worktree branch is renamed together with the remote and the open pull request, and a provisional name takes the thread title on its own
ord: 8
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c13-c481-7acc-8aa6-03cd5dfdb32c
sources:
  - kind: file
    ref: apps/tagma/server/src/worktrees/branches/provisional.ts
  - kind: file
    ref: apps/tagma/server/src/worktrees/branches/rename.ts
  - kind: symbol
    ref: apps/tagma/server/src/worktrees/contract/wire/operations/retirement.ts
    symbol: RETIREMENT_OPERATIONS
---
**Value.** A hastily created branch gets a meaningful name without breaking the published copy and the open PR.

**How.** Rename… in the board row menu; the `rename_worktree` operation; a provisional branch name follows the thread title on its own.

**Behaviour.**
- The name is written as a git branch with the project prefix; the folder keeps its old name, because terminals and agent histories are tied to its path.
- An unpublished branch is renamed locally; a published one is pushed under the new name, and the old one is deleted on the remote only if Tagma made it and pushed it first.
- With an open PR on GitHub it can be carried over: a new PR opens with the same title, body, and base, and the old one closes with a link to the new one. Otherwise the remote and the PR stay on the old name.
- A worktree created with a thread draft gets a provisional branch; when the thread gets a title, the branch takes its name if it has not been pushed yet, the worktree stands on it, and the name is free. A manually renamed worktree no longer follows the title.

**Limits.** A non-GitHub remote or a `gh` failure leaves the remote on the old name. GitHub's built-in branch renames are not used: they close the PR.
