---
id: 01a14c34-f177-7327-a9c3-cab67f3c671d
title: Migrate the threads graph and persistence tests to scoped Effect
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14c19-2ae6-7c7d-9cc2-edc404b6eb7f",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/testing/threads/declaredAgents.itest.ts
  - kind: file
    ref: apps/tagma/server/src/composition/testing/threads/delegation.itest.ts
  - kind: file
    ref: apps/tagma/server/src/composition/testing/threads/folders.itest.ts
  - kind: file
    ref: apps/tagma/server/src/composition/testing/threads/formSteps.itest.ts
  - kind: file
    ref: apps/tagma/server/src/composition/testing/threads/harnessAcceptance.itest.ts
  - kind: file
    ref: apps/tagma/server/src/composition/testing/threads/harnessReaders.itest.ts
  - kind: file
    ref: apps/tagma/server/src/composition/testing/threads/harnessSpend.itest.ts
  - kind: file
    ref: apps/tagma/server/src/composition/testing/threads/harnessTitleAdopt.itest.ts
  - kind: file
    ref: apps/tagma/server/src/composition/testing/threads/inboxKeys.itest.ts
  - kind: file
    ref: apps/tagma/server/src/composition/testing/threads/journalBirth.itest.ts
  - kind: file
    ref: apps/tagma/server/src/composition/testing/threads/journalCarry.itest.ts
  - kind: file
    ref: apps/tagma/server/src/composition/testing/threads/journalReads.ts
  - kind: file
    ref: apps/tagma/server/src/composition/testing/threads/lifeReads.itest.ts
  - kind: file
    ref: apps/tagma/server/src/composition/testing/threads/listStore.itest.ts
  - kind: file
    ref: apps/tagma/server/src/composition/testing/threads/namingRollout.itest.ts
  - kind: file
    ref: apps/tagma/server/src/composition/testing/threads/projection.itest.ts
  - kind: file
    ref: apps/tagma/server/src/composition/testing/threads/repair.itest.ts
  - kind: file
    ref: apps/tagma/server/src/composition/testing/threads/report.itest.ts
  - kind: file
    ref: apps/tagma/server/src/composition/testing/threads/restedReads.itest.ts
  - kind: file
    ref: apps/tagma/server/src/composition/testing/threads/restedReadsWake.itest.ts
  - kind: file
    ref: apps/tagma/server/src/composition/testing/threads/rolloutSync.itest.ts
  - kind: file
    ref: apps/tagma/server/src/composition/testing/threads/targetIntents.itest.ts
  - kind: file
    ref: apps/tagma/server/src/composition/testing/threads/teamDirectory.itest.ts
  - kind: file
    ref: apps/tagma/server/src/composition/testing/threads/titles.itest.ts
  - kind: file
    ref: apps/tagma/server/src/composition/testing/threads/transcript.ts
---
Finish the coherent migration of the graph-backed threads tests and the journal/projection checks: native Effect helpers and runner, test scopes instead of manual runtimes, scoped temp directories, and keeping the verified behaviour. Include a direct consumer of the current declaredAgents and the typed refusal corrupt target-intent row. Before handing over, fully read all changed files and the diff, verify each test file separately, work through one independent Sol review and land the change; the shared remainder of protocol/terminal and other threads tests stays in the parent task. All 23 test files passed separately; two confirmed findings of the single Sol reviewer are fixed: the shared graph fixtures are file-scoped again, the mid-wake check is synchronized with a Deferred on the WriteSet with no delay or polling. The original 24 automatically touched files and their whole diff were fully re-read by hand after the interruption. The last narrow typecheck gave no errors in these sources but ended with errors from the unfinished production journal/lane.ts; this delivery's green dependent typecheck is not proven yet.
