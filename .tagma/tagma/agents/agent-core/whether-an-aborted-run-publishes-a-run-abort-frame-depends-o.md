---
id: 01a0c96e-9eba-7cb4-a19e-3a7132ecffe0
title: Whether an aborted run publishes a run-abort frame depends on which abort path wins
ord: 129
tags: ["task"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: packages/agent/src/agent/turn/call.ts
  - kind: symbol
    ref: packages/agent/src/agent/AgentTurn.ts
    symbol: agentTurn
---
Whether a run's abort leaves a `run-abort` frame in the stream depends on which abort path wins the race, not on anything a reader chose. An abort taken at the handle, at an interrupt, or at the tool-phase checkpoint publishes the frame. An abort landing mid-call settles through the call's own return without it.

So a consumer folding a run's frames cannot treat `run-abort` as the mark of an aborted run: a run aborted while a provider call was open looks, in its frames alone, like a run that simply stopped. The ending is still recorded — the settlement carries it — but the stream's own vocabulary is not uniform, and the zone could state no invariant about the frame because none holds.

This was found while writing the loop's claims and is why the run frame's abort half is unclaimed: the builder declined to state a uniform rule over a frame that is not uniformly published, which is the right call and leaves the defect standing rather than papering over it.

Done when a run's abort either always publishes the frame or never does, and the claim over the run's own frame can say which without an exception.
