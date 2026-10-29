---
id: 01a0e9ff-9b38-73de-9c32-49f722c440cc
title: enforce_rule through the MCP door from a worktree session writes the main graph copy, while that worktree's submit_work gate reads its own copy
ord: 113
tags: ["reflection"]
fields:
  {
    "actual": "It changed main's copy only. The worktree gate kept refusing on the old floor list until `tagma op enforce_rule` was rerun from inside the worktree with the full list. Two waves (wave-power, wave-package-boundary) each lost a refusal round to this, and the copies drifted: main gained floors for paths that exist only on the branch.",
    "command": "enforce_rule (MCP) on rule f49f228f, called by agents whose sessions stand in worktree `restructure`",
    "expected": "The act changes the rule the caller's own gate enforces, or its answer names which graph copy it wrote and that the worktree's copy is unchanged."
  }
---
Filed from project `runlith`.