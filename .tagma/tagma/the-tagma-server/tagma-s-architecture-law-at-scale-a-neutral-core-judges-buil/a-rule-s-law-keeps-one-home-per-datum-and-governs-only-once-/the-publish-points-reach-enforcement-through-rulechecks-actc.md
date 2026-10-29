---
id: 01a0f516-f221-7e86-b5a0-78b2db25dbd7
title: The publish points reach enforcement through `RuleChecks`/`ActChecks` (`before`, `holding`), not `RuleJudgement`
ord: 8
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: discovered-from
    to: 01a0f4ab-e2f6-78f8-ba27-652f269a2dc5
---
Task [[269a2dc5]]'s scope names enforcement's `RuleJudgement` port as the only road from the publish points of `submit_work` and `merge_worktree`. The build uses `RuleChecks` and its per-operation face `ActChecks` instead (`enforcement/contract/service/ruleChecks.ts`, commits 155425704e and 6c9b8a2a41).

Why: both publish points already hold `ActChecks` (`landing/land/commit.ts#commitOwn`, `landing/merge/integrate.ts#integrate`) for `before` and `after`. `RuleJudgement` is consumed only inside enforcement's own serving, so routing through it would add a second port to landing and a new binding at both assemblies for the same judgement.

What stands:
- `ActChecks.before` judges, and its answer carries the law it was judged by (`Checked.law`: project, root, accepted branch and revision).
- `ActChecks.holding(judged, branch, act)` runs the publication `act` under the accepted law's permit (`AcceptedLaw.holding`, rank 295) only while that law still stands on `branch`. Otherwise it answers `None` and the publisher judges again.

Proposed correction: the scope of [[269a2dc5]] reads "through enforcement's rule-check port (`RuleChecks`/`ActChecks`)". `RuleJudgement` keeps judging behind it.
