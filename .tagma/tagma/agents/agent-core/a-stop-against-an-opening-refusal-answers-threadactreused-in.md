---
id: 01a12313-c0d2-7404-bc73-bdc2bf798196
title: A stop against an opening refusal answers ThreadActReused instead of the run outcome
ord: 41
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12314-8263-76d0-a7a2-bc9a6cb1dffd",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a12306-efba-7a0e-94d7-05eed6340847
sources:
  - kind: file
    ref: packages/agent/src/thread/run/lifecycle/closing.ts
  - kind: file
    ref: packages/agent/src/thread/run/lifecycle/RunLifecycle.ts
  - kind: file
    ref: packages/agent/src/thread/run/ThreadStopping.ts
---
At `bun test --parallel=3 ./src/composition/testing/threads/externalCaller.itest.ts ./src/composition/testing/http/threadChildDoor.itest.ts` from `apps/tagma/server`, the endings-reading test received `ThreadActReusedError` with evidence `{runEnd, status:'aborted'}` after `web-unavailable` at opening. The fixture substituted only the stream, so the genuine provider web refused before it; the fixture is fixed, but the ending race is unproven fixed. Start from `RunLifecycle.broke`, `RunClosing.drive`, and `ThreadStopping.stop`: the end key is chosen from a read before locked settlement, while the kernel refuses another digest of the already-recorded end. Reproduce the opening-refusal and Stop race deterministically through the core's public acts, establish the cause, and ensure one kept end with the correct outcome of both acts; done after the owner's passing test. The cause is confirmed through public `finish` and `stop` on genuine InMemory storage: between the failed-key preparation and the write-unit, Stop recorded an intent, then finish kept aborted with the failed digest; the next Stop answered `ThreadActReused` with evidence.status=aborted. `RunClosing` now assembles the state-dependent end plan inside the same write-unit that applies settlement; `broke` and `reap` take that road. The no-tx path holds the input in the journal lane and `ThreadTransitions.writeAt`, including the server opening the journal and a typed failure at an admission refusal or an indeterminate outcome. One independent Opus high review found three extra windows, each confirmed by a red test and fixed. The separate BirthConflict was already fixed by commit 7d3ee05acb. Outcome: typecheck of agent and 191 tests in six owner sets pass; the SQLite lifecycle slice — 11 pass. Two deterministic conformance cases pass on both adapters, rollback covers broke, lane checks guard refusal and stalled outcomes. The full SQLite runner budget is already exceeded without these additions: 9377 ms CPU against an 8000 ms ceiling; that is moved to a [[377e8e5a|separate task]].
