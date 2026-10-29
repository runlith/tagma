---
id: 01a15987-1bac-7bff-889d-f8fe1f559854
title: A signal to an idle thread awaits its next turn in the inbox, so a new signal can remove the former unread one
ord: 86
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16543-8df5-7d63-8b6f-efff453731fb",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a15963-9d3a-7088-9b4c-7b504b9e8ea0
sources:
  - kind: file
    ref: packages/agent/src/thread/run/scheduler/inputs.ts
---
A signal to an idle thread awaits its next turn in the inbox, so a new signal can remove the former unread one.

Currently `ifIdle: 'persist'` (`Inputs.persist`) appends the signal to the idle thread's history at once and confirms the inbox item, so `retractSignal` removes only a signal to a working thread. The `child-agent-update` lines to an idle parent therefore accumulate one per transition instead of replacing each other. A rest-mode is needed in which the signal stays queued until the next turn opens and enters its beginning, without waking the thread. Verify along the road: thread snapshot (`pendingInputOf`, `latestRun` on queued items), opening a turn from rest, a turn on an operator word (`wakeItem` with `seed`), keep-warm. Proof: a conformance test of signals — two signals to an idle one, the second removes the first, the next turn sees only the second; the `childUpdates` driver switches to the mode.
