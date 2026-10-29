---
id: 01a11ca5-7ddf-7f42-a891-bd606168d447
title: "ACP word decisions at the scheduler: launch, deliver, withdraw, interrupt; follow-up wake for every thread; lead from RunGuidance"
ord: 11
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a11c9a-6edb-7ed8-b517-60af35a07ee2
---
What: [[35a07ee2]], "Opening", "Words mid-run", "Next run"; the `prompt` channel of `RunGuidance` [[2121a95f]]. The decision in `ProtocolInputs.admitted` and the "what to send next" choice in `prompts.ts` go away; `unhosted` is removed; the protocol row's `law` field goes away. The ACP registration and every `TransportRuns` method it calls ship with the scheduler switch: a registered adapter answers with launch, hold, or interrupt instead of a stub. The contract writes word fates; the driver only reports receipts.

Proof: the race tests from the [[35a07ee2]] criteria (Enter at the moment of an agent answer, steer into a finished run, Esc with steers, crash between opening and `launch`); `protocolWords.stest.ts` and `protocolMethods.stest.ts` with no change to the visible assertions.
