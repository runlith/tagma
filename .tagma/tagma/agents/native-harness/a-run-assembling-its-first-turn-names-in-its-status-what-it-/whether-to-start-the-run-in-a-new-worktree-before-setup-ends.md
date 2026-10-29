---
id: 01a13ba2-803d-7614-a6da-353309a80ba9
title: Whether to start the run in a new worktree before setup ends, so only the tools needing its result wait on it
ord: 1
tags: ["idea"]
fields:
  {
    "status": "open"
  }
---
Question: whether to start the run in a new worktree before its setup finishes, so only the tools that need its result wait on setup rather than the whole first turn.

Why it is worth considering. Today the turn context waits on `setups.ready` (`native-harness/turns/context.ts:173`), and the model's first step does not run until setup finishes. On 2026-10-14 runlith setup (`bun install --frozen-lockfile && bun run --cwd packages/window-behavior build`) ran 46 s at 29 s CPU. An agent's first steps usually read the graph and files, which need no setup.

What decides the choice:
- Which tools need the setup result. Explicitly — `bash` in the worktree, tests, typecheck. Implicitly — reading files setup builds or copies.
- How the agent learns setup finished or failed. Now a setup failure reaches context once, at turn assembly (`worktreeSetup`, `context.ts:170–173`), and would not refresh mid-run.
- How the wait looks at the call: the call phase "waiting" with a reason exists on `AgentCalls` (`stage('waiting', detail)`).
- Why the turn waits on setup now: the decision is not recorded in the graph. It is worth finding or recording before changing it.

Uncertainty: the share of first steps needing setup is unmeasured.
