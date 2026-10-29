---
id: 01a14df5-19bb-70fa-bbb2-078c4423cf57
title: "Flaky parity-line checks: acp.release session-uncertain in parity.stest and a wake reads each fact in the agent"
ord: 12
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14cfa-01f6-7d00-af4d-7f2b2b1aecb7",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a14da6-0543-79a6-bc98-168134de55e9
---
Two signals the parity-line implementers saw once and could not reproduce on retry.

- `apps/tagma/server/src/composition/testing/threads/parity.stest.ts`: in one full run 4 failures on `acp.release: session-uncertain`, a retry passed (parity-end, work 34de55e9). A possible race of ACP session release against the turn end — then it is a product defect, not a test one.
- `packages/agent`, test "a wake reads each fact as often…" counts by time and passes 2 out of 3; "a run killed mid-tool resumes…" failed once in a full `src/thread` run (parity-step, work 0aee0af9).

Start by reproducing `session-uncertain` with back-to-back suite runs and reading where release sees the session as uncertain. Proof: the found cause fixed at its owner with a test that catches it; the timing test rewritten onto a fact or deleted.

## Outcome (de7a6721e8, 3767bd9f3b)

- `session-uncertain`: no product defect. Reproduced only under load: two parity runs in parallel. Single runs — 8 in a row without it. Chain: a server-restart scenario overran its 15 s budget, the interrupted handover left the ACP session `uncertain` (`WireLost` in drive), and release by contract refused `session-uncertain`. The cascade onto the next tests came from `parityWorld.quiet`: it stopped at the first archive refusal and never cleaned `born`, so every later cleanup failed on the same thread. Now `quiet` archives all threads and reports all refusals; restart scenarios get a 60 s budget like their neighbours. After the fix two parallel runs twice — zero `session-uncertain`; only timeouts of individual scenarios under double load and others' unfinished tests remain.
- "a wake reads each fact…": the extra reads came from the `ThreadSnapshots.reconsider` status-deadline timer (span `ThreadSnapshots.reading`), which inherits the caller's references including the test's open mark. The test no longer counts reads under `READING` (the constant is exported from `ThreadSnapshots`), and counts open-run publications by distinct `life`, because the deadline re-publishes the same `life` with changed `ownership`. 6 and 12 repeats in a row — no failures.
- "a run killed mid-tool resumes…": not reproduced. 3 full `src/thread` runs and every full package run after — no failure. Cause not found.

Not proven: the `quiet` fix is not covered by a deterministic test, only by repeated runs; the weakened publication count (by `life`) would miss a double publication with the same `life`.
