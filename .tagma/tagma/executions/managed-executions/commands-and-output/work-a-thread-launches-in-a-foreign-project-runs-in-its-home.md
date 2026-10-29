---
id: 01a15baf-21e1-7912-9b17-946a487f926d
title: Work a thread launches in a foreign project runs in its home scope; a command's call project only addresses records
ord: 8
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a15ba1-aa7b-74a8-925f-7d9827c7ba98
  - kind: relates
    to: 01a12759-daf0-753f-9905-a6752d0b78de
sources:
  - kind: symbol
    ref: apps/tagma/server/src/executions/commands/eligibility.ts
    symbol: commandEligibility
  - kind: symbol
    ref: apps/tagma/server/src/executions/terminals/principals.ts
    symbol: custodianOf
---
A thread's command records — the inventory, the owner fence, its command rules, kinship and command refusal on thread deletion — live under the thread's home, so a command's owner always works in its project ("ownership never moves work between projects"). A thread working in a foreign project doesn't move there: the work it launches — `bash`, checker programs, linters, commit steps, config — it launches in its home scope, while the place is set by `cwd` in the foreign checkout, and the place rules are taken by it ([[2d0b78de]]).

So the actor on whose behalf a call launches work is the thread with the home project (`custodianOf`), not the call project. That is how the rule-court operations receive it (`check_rules`, `enforce_rule`, `set_module`, the git hook's `record_commit` write) and both landings — `commit_checkout` through `CheckoutActor`, `submit_work` from the thread's work place; the same actor receives rule notifications for its home. `merge_worktree` keeps this actor together with the home in the queue and the publish request: the immediate pass, the queue retry and the tail after-checks all use the same belonging. Stamping with the call project (`executionActorOf` with the call project) would send another project's checker into its scope, and another home's owner thread would be refused.

A command's call project is addressing only: the execution is looked up in the records of the named project (`origin.projectId !== scope` is `foreign-project`), and the launch goes to its own scope's target. A thread isn't refused for working in another project: it reads, awaits and stops the named project's commands just like its own.
