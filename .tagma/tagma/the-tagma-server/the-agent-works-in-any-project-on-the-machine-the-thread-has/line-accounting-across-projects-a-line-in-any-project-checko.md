---
id: 01a12726-9e16-7f6a-a8a2-1531ada88e6f
title: "Line accounting across projects: a line in any project checkout on the machine, the holder judged by its home"
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12726-f0ea-7f35-b027-6fc995b37886",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a126b3-84d8-7b0e-a605-99311013e071
  - kind: relates
    to: 01a12726-9e16-7f6a-a8a2-152f37d7c9ad
sources:
  - kind: file
    ref: apps/tagma/server/drizzle/20261010185630_change_holder_home/migration.sql
  - kind: file
    ref: apps/tagma/server/src/change-record/record/intake.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/record/sessions.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/retire/store.ts
  - kind: file
    ref: apps/tagma/server/src/workspace/checkouts/paths.ts
  - kind: file
    ref: apps/tagma/server/src/workspace/store/rootRegistry.ts
---
The spec's "Line accounting" section.

Do: `Intake` (`change-record/record/intake.ts`) places the line in the checkout containing the file, across all projects' checkouts on the machine (currently outside home — with `kept: false`). The line carries the place's project and, separately, the holder's home; cleanup of deleted threads (`retire/store.ts` `orphaned`), holder reads, `read_changes {agent}`, `taking`, the turn/end/commit history (`record/sessions.ts`, `operations/changes.ts`, `changes/stream.ts`) check the "thread and its home" pair (rule `30cfaf9e`), not "thread and the line's project". A command with `workdir` in a foreign checkout is measured as in one's own. Stored lines migrate once.

Proven by `crossProject.itest.ts`: A's writes and commands in B keep the holder's home; the cold retire driver does not revoke live lines; `read_changes`, `record_write`, taking of the operator and thread B, the commit overlay, the index-build race, and root moves are verified. 13 tests in six files passed, including migration with refusal on ambiguity and rollback, the command checkout barrier, and naming a foreign holder in the comment sweep; of `retirement.itest.ts` only the earlier `lines returned to HEAD` timeout scenario was checked. Two Sol xhigh reviews were credited by the operator, confirmed findings fixed. The last narrow typecheck did not finish clean: nine errors in the concurrently changing `packages/agent`, none in this task's files. The full build and tests were not run; live-server verification stays with the operator.
