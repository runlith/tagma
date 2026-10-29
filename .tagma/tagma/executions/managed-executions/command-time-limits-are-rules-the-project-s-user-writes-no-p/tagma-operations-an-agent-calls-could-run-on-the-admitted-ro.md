---
id: 01a0cf92-86fa-704b-810e-bf5f1b104ee8
title: Tagma operations an agent calls could run on the admitted road, so command rules bound them through the "through" field
ord: 2
tags: ["idea"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a0cf38-b201-7723-b919-48c38cb4e34f
---
On 2026-09-23 the operator asked whether one rule could give `submit_work` 60 seconds while a `git commit` typed in `bash` gets 30. The rule's shape already has a "through" field for this, and [[8cb4e34f]] matches only `bash` on it.

To bound an operation, three things have to change:
- **Its processes must reach the host.**
  - Today `submit_work` runs git through `ServingGit`.
  - `CheckoutActs` (checkout_stage, commit, push, discard, abort), `Repositories`, `Worktrees` and `CheckoutStatus` run the platform `git` built once per installation (`graph/projects/WorkingOwners.ts`), and they are shared with the app's own doors.
  - `strip_comments` holds the graph's `Git`.
- **An operation ended part-way must leave the checkout sound.** `submit_work` would unstage only the paths its own `add` staged that were not staged before. Restoring a saved index would erase other threads' staging in a shared checkout. A hard kill that leaves `.git/index.lock` needs its own answer.
- **A whole-operation bound needs an enforcer.** `submit_work` is a server fiber that runs several executions, so the server would interrupt it at the deadline and stop the execution that is running.

What would inform the choice: how often an operation actually runs long enough to need a bound, and whether the app's operator acts should stay on the platform road, since no rule reaches them.