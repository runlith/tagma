---
id: 01a16eec-b40f-7ab7-b313-475ddd4df78b
title: A working thread on main fails with world-unavailable RootConflict (registry-changed) when someone changes the checkout registry
ord: 99
tags: ["reflection"]
fields:
  {
    "actual": "A run that ran 3 h 38 min (133 M input tokens) ended failed: «world-unavailable: the checkout target would not resolve: RootConflict (registry-changed) · WorldUnavailable». 13 s later a new run 01a16eec started, but the turn broke off mid-work, and 4 paths stayed uncommitted.",
    "command": "run 01a16e23-eb48-7e10-bc53-519fe08f3e2b of thread 01a16ded-9175-7310-be64-e74945295153 (openai-oauth, main checkout /opt/workspaces/runlith), next step around 2026-10-24T17:18:52Z",
    "expected": "A thread standing in the main checkout survives a worktree-registry change (someone else's worktree created or deleted) and continues the run with a re-resolved target."
  }
---
Filed from project `runlith`.

At the same time other team agents created and deleted detached worktrees in the temp dir and in the project's worktree dir. The main checkout thread changed nothing. The `registry-changed` failure is repeatable by nature: it says the target needs resolving again, not that the world is unavailable.
