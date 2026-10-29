---
id: 01a0c4f7-923e-755f-9b2e-9f4c001a00cc
title: "Opus 5 at high: five owners, a batch that keeps its calls, and every moved block line-identical"
ord: 2
---
Opus 5 at high cuts five owners into a 219-line residual, and is the only run whose every moved block diffs line-identical against the pin.

- **The cut.** `AgentStepLedger` holds the committed steps, `AgentRunEnding` the five deferred faces and the closed latch, `ToolCallBatch` the step's prepared calls, `ToolInputStream` one reader per open call id; `ModelAttempt` carries one call's fold, born and dead inside it.
- **The batch keeps its calls.** `prepareToolCalls` closes over them and the model's content, and answers `intent`, `run` and `settled` from that memory. The residual never sees a prepared call — the test [[4a73da8f|Opus at medium]] and [[f1faa1d1|low]] fail.
- **Nothing new went down.** Each module declares its own narrow input, which the residual's `AgentTurnDeps` already satisfies: the call site hands over nothing it did not hold. The door narrows to the methods each uses and is reached as a property, so `this` survives.
- **Its one crossing port was narrowed, not invented.** The pin itself passed a mutable `{current}` cell into the attempt; here the latch stays in the residual and only `inject` crosses.
- **Both findings, again.** `agentToolSources` moved to `ToolCatalog`, and the private outcome type ships as `ToolCallOutcome` — no second `AgentToolOutcome` by the door's.
- **What I checked.** The projection's `steps.at(-1)` became a `previous` value nothing can change between the two attempts. `tsc` exit 0, 605 pass / 2 fail, re-run by me in its guest.
- **Cost.** 16 minutes, 74k written tokens, under both xhigh runs.
