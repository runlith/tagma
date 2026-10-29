---
id: 01a14f3e-a5c6-7cc7-afbe-7f4b297b18ea
title: "Publishing an evicted thread's snapshot does not fall with WaitUnderHold: Team/Solo switch and opening a run on it pass"
ord: 61
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14f31-7893-7ef1-bae4-0ee6f45af3a8",
    "status": "done"
  }
sources:
  - kind: file
    ref: packages/agent/src/thread/run/ThreadSnapshots.ts
  - kind: file
    ref: packages/held/src/Lane.ts
---
`set_thread_delegation` publishes a snapshot of every thread in the subtree. `ThreadSnapshots.publish` holds the `agent-snapshot-lane` and reads the journal; at an evicted thread with a compressed rollout the read (`RestedRollouts` → `forms.readable`) enters `thread-journal`, and `Lane.enter` dies with `WaitUnderHold`: the call answers 500, the app shows a server fault, although the switch is already recorded. The same defect in the log drops run opens. A second defect of the same class: re-entering a lane from inside its own step died with `WaitUnderHold` instead of the typed `ReentrantCall` awaited by `forms.within` (failure "Settlement notification failed … thread-journal while holding thread-journal").

Fix: in `held/Lane.ts` the re-entry check runs before the wait check; the `ThreadResidence.reading` port — snapshot publication runs inside it, the server opens the evicted thread's rollout (`RestedRollouts.readable`) before the snapshot lock and holds the eviction (`rollouts.using`) until publication ends.

Proof: a `Lane` re-entry test; `rolloutDrill.stest.ts` — `setDelegation` on a thread evicted with compression is red without the fix (the same `WaitUnderHold`) and green with it.
