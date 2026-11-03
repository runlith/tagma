---
id: 01a14c13-c481-7acc-8aa6-03b329e7e083
title: "Every uncommitted checkout line knows its holder: a thread, the operator, or nobody"
ord: 1
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-928db50ae262
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-6944756614a0
  - kind: relates
    to: 01a14c13-c481-7acc-8aa6-03b4a952bc4b
  - kind: relates
    to: 01a14c13-c481-7acc-8aa6-03b58c7d795b
  - kind: relates
    to: 01a14c13-c481-7acc-8aa6-03c6a28ec4cb
sources:
  - kind: dir
    ref: apps/tagma/server/src/change-record/holdings
  - kind: file
    ref: apps/tagma/server/src/change-record/operations/record.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/record/commands.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/record/intake.ts
  - kind: symbol
    ref: apps/tagma/server/src/change-record/contract/wire/writes.ts
    symbol: CHANGE_WRITES
---
**Value.** Several agents and the operator write into one checkout, and Tagma knows whose lines are whose instead of guessing by git: so the Git tab, review, rollback and the names in a landing receipt rest on authorship.

**How.** Automatic, on every write: the agent's file tools, the operator's edits in the Tagma editor, foreign CLIs' writes reported by their hooks (`record_write`), and shell commands. The accounting is read by `read_changes`, `read_authorship`, `read_checkout`, the Git tab, and the thread Changes panel.

**Behaviour.**
- A typed write records the fact first, then writes the file; after a restart, unconfirmed writes are resolved from disk, so lines aren't attributed to anyone by mistake.
- A command's writes are attributed to its thread by process lifetime. If another thread's command wrote at the same moment, the shift stays nobody's and is named in the command answer and in the landing. A command provably only reading counts as no writer.
- A foreign CLI hook message lands after the file write, so a parallel command may take the shift first.
- A line's holder is whoever wrote it last. Binary, too-large files, and symlinks are held whole by all writers of the version chain from HEAD.
- Lines leave accounting by commit, rollback, or checkout deletion; a vanished folder alone is no deletion but a possible move.
- Authorship decides what a commit says and a rollback touches, never what a commit may carry: `submit_work` lands whole files with every writer's lines in them, names the other writers in `carried`, and a thread's lines still roll back alone.

**Limits.** Edits from the operator's own terminal and from editors outside Tagma are nobody's; they ride a landing with the file they stand in and are named in `unattributed`. Git metadata and the graph store aren't in accounting. There is no act to take nobody's lines as one's own, and none is needed.
