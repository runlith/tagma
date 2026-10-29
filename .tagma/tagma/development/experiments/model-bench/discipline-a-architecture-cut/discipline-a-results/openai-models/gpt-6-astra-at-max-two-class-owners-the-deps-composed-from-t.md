---
id: 01a0c4f7-9239-7680-9748-e914be67586f
title: "GPT-6 Astra at max: two class owners, the deps composed from them, and the door handed over whole"
ord: 2
---
Astra at max leaves 282 lines over two class owners and derives the residual's dependency type from theirs — the field's best port composition, spent on its loosest door.

- **The cut.** `AgentModelStep` holds the `{current}` injection cell as a private field across an attempt and its retry; `AgentToolBatch` holds the response and its prepared calls behind a private constructor, with `prepare` as its factory.
- **The declarations compose upward.** `AgentTurnDeps = AgentModelStepDeps & AgentToolBatchDeps & {…}`: the residual's contract is derived from what its children declared, not the reverse. No other entry writes it this way.
- **The commit moved down with its guard.** `commitIntent(stepNumber)` carries the pin's condition and payload unchanged, so the residual no longer filters calls it does not hold.
- **The door contract was rehoused** into `AgentToolDoor.ts`, where its members live — nobody else did that — and then handed WHOLE to both owners: the model step declares `preflight` and `settle` it never calls, where [[ec59b0b6|its high run]] sliced the door with `Pick`.
- **Settlement stayed above**, as at high: steps, five faces and latch remain in the residual.
- **The collision shipped**, and `agentToolSources` stayed, as everywhere but Opus.
- **Verified.** Compared line for line against `b1f8e9da5`: every difference is class syntax, destructuring or a signature — no logic line changed. `tsc` exit 0, 605 pass / 2 fail, re-run by me. 20 minutes and 32k written tokens against [[6e83410a|Opus at max]]'s 88k, for 90 more lines.
