---
id: 01a0c4f7-922e-711d-93eb-1062c12b7eb7
title: Separate historical and current-code workers so an allowed second tree cannot reveal the answer
ord: 5
tags: ["idea"]
fields:
  {
    "status": "open"
  }
---
The original benchmark allocation gave one C worker both the historical broken door and a newer tree containing its repair, so the allowed input itself discloses an answer.

- **Recommended allocation.** A, C-1 and C-2 use separate fresh contexts and worlds for each model. C-2a and C-2b may share one world because both are assigned fixes on the same snapshot. This changes the solver count and needs confirmation before launch.
- **Alternative to assess.** Keep the original solver count only if a frozen C dataset can contain all assigned bugs without containing their historical repairs, and the prepared dataset passes an independent leakage check.
- **Boundary.** Never ask a model to forget a newer tree, never switch its world silently between tasks, and never call a context isolated merely because its two folders are separate. The environment design `57a174d4` supplies isolation, not this allocation decision.