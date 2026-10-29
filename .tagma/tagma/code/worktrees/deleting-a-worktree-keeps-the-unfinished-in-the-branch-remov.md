---
id: 01a14c13-c481-7acc-8aa6-03d0ad0de7bf
title: Deleting a worktree keeps the unfinished in the branch, removes the folder and record, and archives its threads
ord: 9
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-9288c2f9fd4b
sources:
  - kind: file
    ref: apps/tagma/server/src/landing/preservation/commit.ts
  - kind: file
    ref: apps/tagma/server/src/worktrees/retirement/delete.ts
  - kind: symbol
    ref: apps/tagma/server/src/worktrees/contract/wire/operations/retirement.ts
    symbol: RETIREMENT_OPERATIONS
---
**Value.** One button removes a worktree whole yet can't erase unfinished work.

**How.** Delete on the board and in the row menu; the `delete_worktree` operation.

**Behaviour.**
- First everything holding the worktree stops: agents, terminals, and commands; an agent call that would stop them asks the operator in review.
- The graph commits its directory; uncommitted and untracked are committed into the branch with the names of threads whose lines stand there.
- The folder leaves whole, including the ignored; an already missing folder doesn't hinder.
- A Tagma branch is deleted if its merge would change nothing in the base except the graph; otherwise it stays an ordinary branch, and the answer names its commits. A detached worktree keeps the commit on a new branch.
- The worktree's threads are archived; the record, merge checks, and pending merge leave.
- In trust, the operator is asked only when the folder has uncommitted files.

**Limits.** A running git operation refuses deletion. A thread can't delete the worktree it stands in. A branch Tagma didn't create, Tagma doesn't delete. There is no worktree archiving and restore.
