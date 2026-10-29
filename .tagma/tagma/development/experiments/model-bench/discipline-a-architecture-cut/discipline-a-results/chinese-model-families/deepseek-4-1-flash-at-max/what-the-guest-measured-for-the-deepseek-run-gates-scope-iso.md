---
id: 01a0c4f7-925b-75a6-bd4e-e02c4238efd2
title: "What the guest measured for the DeepSeek run: gates, scope, isolation and cost"
ord: 2
---
What the guest itself answered for the [[16741b4e|DeepSeek run]], re-run after the report rather than taken from it.

- **Gates.** `bun run typecheck` exits 0 with no diagnostics; `bun test` answers 605 pass, 2 fail, 1710 expect() calls across 64 files — exactly the recorded baseline, the two reds being the `shipped.test.ts` cases that read the absent `.tagma/workflows/review.json`.
- **Scope.** Nine TypeScript files stand newer than the snapshot: the six new owners, `AgentTurn.ts`, and `AgentRunner.ts` and `AgentSignal.ts` for the declarations that moved. The report names the same nine.
- **Nothing to copy from.** The guest carries no `.git` and no `agent/turn/` directory, so the landed reference cut `c18b9930f` was unreachable from inside the tree.
- **Cost.** 12.95M input tokens and 118 626 output over 12 minutes 30 seconds. Opus at max spent 6.47M input and 88k output on the same task: this row is cheaper per token, not thriftier with them.
