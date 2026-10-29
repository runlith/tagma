---
id: 01a15f9a-2dc6-778a-a5cc-9a636e8d72e0
title: "A word arriving while the model writes the final answer is read by the same turn: a successful text-only step at waiting words continues the run"
ord: 14
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a15eeb-6b48-7ca8-9c93-24d7bd56424f
sources:
  - kind: file
    ref: packages/agent/src/agent/AgentTurn.ts
---
Before ending a successful one-text step the loop asks `signals.hasPending`. Waiting words continue the run: the next step takes them (`drain`) and answers, and `beforeClose` counts on the genuine end. A line marked to wait for the next turn (`waits`, [[fa4f58b1]]) does not continue the run: `hasPending` asks only about words demanding a step. Otherwise a word sent into the running turn (steer) would open a new run — becoming a follow-up.

A step cut by the output limit continues the run by the continuation policy, and the next step takes the waiting words. The filter and the step bound (`stopWhen`) end the run: the words wait for the next turn.
