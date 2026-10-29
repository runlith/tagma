---
id: 01a0d351-0689-7610-ad63-a8da0e047b0b
title: "Try ×N: one prompt in several worktrees on different models, compared and one merged"
ord: 30
tags: ["idea"]
fields:
  {
    "status": "open"
  }
---
**Question:** should Tagma run one prompt in N worktrees on different models, with a comparison view where the operator picks one to merge and archives the rest (artifact section 09)?

**Motivation.** Comparing candidates side by side is where isolation pays most.

**What would inform the choice:**
- whether the operator actually runs parallel candidates once single worktrees work;
- the token cost of N full runs;
- whether the per-file comparison matrix reads well with real diffs.

It builds entirely on the other children, so it waits for them.
