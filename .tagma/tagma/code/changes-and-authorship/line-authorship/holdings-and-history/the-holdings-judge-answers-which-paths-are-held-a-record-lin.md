---
id: 01a12c9a-60da-70ae-8b41-3cf93eec0704
title: "The Holdings judge answers which paths are held: a record line in held is only an unfinished exit, not a holding"
ord: 3
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a12c8a-b8b4-7948-a37d-ecee0de789c6
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/operations/changes.ts
  - kind: file
    ref: apps/tagma/server/src/landing/land/submit.ts
  - kind: symbol
    ref: apps/tagma/server/src/change-record/holdings/totals.ts
    symbol: owes
---
The Holdings judge answers which paths are held: a record line in `held` is only an unfinished exit, not a holding.

A `workspace_change` line in `held` state only means retirement has not yet proven its exit: an open command window of the same thread defers the exit (the command may recreate the file), a line with its own unchanged head is stored for recovery through stash, and a line on a path outside git leaves only at an archived thread. So the Holdings judge — not the line state — answers "which paths does the holder still hold": `read_changes` (`held`, `checkouts`) and `held` in `turns` read one projection, the judge's `holdersOf`, with unproven, without paths outside git (`owes`).

Line state stays a candidate: it selects the paths to judge, and only the judge decides whether the lines stand. An unread or unanswered judgement is named in `unrecorded`, never replaced by a stale pre-retirement verdict. `turns` reduce `held` to `cleared` only on the checkout side in `current` state: an `opening`/`judging` snapshot is partial, and a path missing from it proves nothing. A proven committed outcome is visible in `commits` and `turns` before the durable exit of the line: an open command defers releasing the record but never hides a known landing. Holding uncommitted lines still answers Holdings regardless of that outcome.

`submit_work` does not wait for the judge. Its selection and its `left` read the team's held rows and command observations straight from the record and keep a file only while git says it still differs from HEAD, so a file that went back to HEAD drops out by git, not by retirement. The receipt's `unattributed` comes from the rows themselves: a carried file whose working bytes the row chain from HEAD does not explain.
