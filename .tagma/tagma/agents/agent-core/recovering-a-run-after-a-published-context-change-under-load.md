---
id: 01a17971-50e6-7304-ac57-505b349f6c92
title: "Recovering a run after a published context change under load finds nothing: recoverNow answers 0"
ord: 114
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1794b-b79a-7bae-b6cc-afa9c50eb203",
    "status": "done"
  }
sources:
  - kind: file
    ref: packages/agent/src/thread/conformance/runLog/contextChanges.ts
---
`packages/agent/src/thread/conformance/runLog/contextChanges.ts` › "a run the successor recovers after it published a change is prepared over the place it moved to" (InMemory) failed once in the full `test:all` of the public tree on 2026-10-26: `processB.harness.runs.recoverNow()` returned 0 instead of 1.

**Cause — a race in the test; the product behaves correctly.** Process A is not closed: it plays a lost process but is alive and still writing. The test handed the turn to process B as soon as the context change was published. A's first step ("Working here.") is written by `ThreadStreamRecorder` on its own fiber, in one transaction with the `streaming` stage and a new `heartbeatAt`, and that write could land after publication. The reaper B takes someone else's run only when `heartbeatAt < now` (`takeoverAfterMs: 0`). If A's write lands between B's `now` and its takeover, the run is not abandoned, and the takeover honestly does not happen.

**Evidence** (probe of the report scenario, InMemory, `it.live`, macOS, load 15–98):
- without the fix — 1 answer of 0 in 60 rounds. In that round, before `recoverNow` run A had stage `starting`, `heartbeatAt …760`, B's `now` — `…823`; after the call the run was still A's, with stage `streaming` and `heartbeatAt …831`;
- with A's reset delayed 20 ms the first step is still unwritten at handover in 97 of 100 rounds, and the answer is 0 in 2 of them;
- waiting before B for A's last write — the assistant message in the transcript, like the neighboring lost-process test — leaves nothing unwritten at handover, and there are no 0 answers: 0 of 200 with 20 and 60 ms delays, 0 of 300 without delay.

**Fix:** the test waits for A's last write — the assistant message in the transcript, like the neighboring lost-process test.
