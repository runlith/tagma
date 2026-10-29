---
id: 01a14543-b28f-7158-b5a8-28b8ecafcea1
title: A child run fails with HoldCut and an empty reason, leaving no way to tell whether to retry
ord: 5
tags: ["reflection"]
fields:
  {
    "actual": "Report: \"failed before finishing (stage thread, type HoldCut, retryability unknown, model execution start unknown): HoldCut: \" — empty message, after about 290k tokens of work with 10 uncommitted files in the worktree; the parent can only guess and continue_agent.",
    "command": "spawn_agent agentId=code model=claude-opus-5-5 worktree=core-foundation (thread 01a1452c-c5f4-7caf-b119-0c562922ed77)",
    "expected": "If the run is cut, the report names what was held and why it was cut, and whether the same call will fail again."
  }
---
Filed from project `<project>`.