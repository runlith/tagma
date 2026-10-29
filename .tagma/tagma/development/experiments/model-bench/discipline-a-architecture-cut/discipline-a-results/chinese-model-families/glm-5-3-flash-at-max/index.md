---
id: 01a0c4f7-9241-7c53-b0d1-a35fb351bf7b
title: GLM 5.3 Flash at max
ord: 2
---
GLM 5.3 Flash at max cuts a 208-line residual over six modules, of which four hold state, and is the only entry that checked its cut against the packages downstream of it.

- **Four of the six hold state** — the settlement, the attempt, the streamed inputs and the batch — and the other two are a pure fold and a pair of type declarations, which the report names as such rather than dressing them as owners, the way [[4a73da8f|Opus at medium]] did.
- **The declaration moved down, and the residual kept pointing up.** `AgentModelContextInput` and `AgentModelContext` left `AgentRunner.ts` for a file of their own, but `AgentTurn.ts` still imports them **from `AgentRunner`**, which re-exports — so the upward type edge the original had still stands. [[16741b4e|DeepSeek]] removed that edge entirely.
- **The one place the report and the diff disagree.** It calls that import "type-only for `AgentStreamOutput`, exactly as the original file had"; the statement on line 16 names all three types, two of which it had just moved below. Everything else it claims, the code shows.
- **It looked further than its own package**, typechecking and testing five dependents; where checked, the claim holds — `agent-tools` answers 147 pass, 0 fail. The collision shipped from `AgentStepFold`, and `agentToolSources` stayed in the residual.
