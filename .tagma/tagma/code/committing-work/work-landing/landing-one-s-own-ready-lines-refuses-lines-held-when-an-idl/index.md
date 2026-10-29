---
id: 01a16487-9741-727f-8ed9-9973d2548c8d
title: Landing one's own ready lines refuses lines-held when an idling peer's lines stand in the same regions, and sessions wait on each other in a circle
ord: 112
tags: ["reflection"]
fields:
  {
    "actual": "A lines-held refusal over 4 files; the holder of most lines has idled since 16:28, while the thread-events owner waits for child-retune to free its files — a circular wait with no way out but carry on the operator's word",
    "command": "child-retune (01a16462-8289-7661-b98c-cb52ccb71e8d) submit_work with no paths, the 87a7ab7d task's work ready and checked",
    "expected": "One landing lays down this session's ready lines, or the refusal names a way out that depends neither on the idling peer nor on the operator's word for taking others' lines"
  }
---
Filed from project `runlith`.

The operator called this a critical Tagma defect: it must not be so.

Evidence (runlith, 2026-10-22, ~16:45–16:52 UTC+2):
- child-retune holds its own lines next to others' in the same regions:
  - `apps/tagma/server/src/external-harnesses/store/sessions.ts` — own +4; cursor-compaction (01a16449-9929-77de-9087-758d183b0763) +14/−4;
  - `apps/tagma/server/src/threads/testing/doubles.ts` — own +4; cursor-compaction +3;
  - `apps/tagma/server/src/composition/testing/threads/hostedAccounts.stest.ts` (moved from `.itest.ts`, untracked) — own +2; cursor-compaction +78;
  - `apps/tagma/server/src/threads/harness/engine.ts` — own +6; session 01a16479-7453-7894-bda1-cf5a9581a855 +8 (working).
- cursor-compaction: last run finished at 16:28:56Z, the thread idles; its lines stay uncommitted until its parent continues it.
- thread-events (01a1644c-1642-74f9-b30d-50701095ab2c), the thread-events owner, reported waiting for `happened.ts`, `childUpdates.ts`, `engine.ts` to be freed by child-retune to move them to shared delivery; child-retune waits on cursor-compaction and the session in engine.
- The server typecheck is red (64 errors) on the uncommitted wide transition of external harnesses and subscriptions at peers, so `whole: true` would have landed someone else's unfinished work.

Cost: a ready, checked (system test 4/4, unit 4/4, review with a fixed finding) delivery does not land; the 87a7ab7d task and the thread-events move stand for an indefinite time; the only way out is the operator's word on carry, risking landing code that does not build.
