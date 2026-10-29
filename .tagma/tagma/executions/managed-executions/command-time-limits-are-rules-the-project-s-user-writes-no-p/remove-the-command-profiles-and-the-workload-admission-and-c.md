---
id: 01a0cfab-7228-79f3-a863-a79450212475
title: Remove the command profiles and the workload admission, and change the command limits to carry an optional time with its origin
ord: 6
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0d021-26db-71cb-8076-066b343adade",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0cf38-b201-7723-b919-48c38cb4e34f
  - kind: waits-on
    to: 01a0cfab-71f2-7cd2-bd1b-64755edc3914
---
This is stage 1, part 1 of [[8cb4e34f]]: the vocabulary and the host, built as one change because it only compiles whole.
- **Scope:**
  - the workload and the profiles go;
  - `CommandLimits` and `CommandDeadline` change as the Contract says;
  - the host admits without a workload, and `CallLifetimes.ts` revises commands without a ceiling;
  - the managed world and `ServingGit` gate on the host offering the command road;
  - the launch request names its tool;
  - the `commandPolicy.*` settings and `adopt_command_profile` go, with the server migration and the app's workload views.
- **One origin type.** The wire's origin of a deadline (`caller`, `default`, `rule`) becomes the one type. `CommandTimeOrigin` in `apps/tagma/server/src/protocol/commandRules.ts`, landed by [[252bf193]], is replaced by it, not kept beside it.
- **Before starting:** the stop-ladder task must have landed.
- **Proof:** acceptance criteria 4, 6 and 10; typecheck clean across the packages touched; the host, terminals and harness suites green.