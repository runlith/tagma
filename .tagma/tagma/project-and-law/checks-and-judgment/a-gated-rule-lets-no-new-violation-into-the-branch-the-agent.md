---
id: 01a14c14-a11c-7ce8-9d84-633588b4c33c
title: "A gated rule lets no new violation into the branch: the agent's landing is refused, others' unfinished lines land marked"
ord: 2
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c14-a11c-7ce8-9d84-63363d3e5239
  - kind: relates
    to: 01a14c14-a11c-7ce8-9d84-633958074d0c
sources:
  - kind: file
    ref: apps/tagma/server/src/enforcement/judging/excess.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/judging/judge.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/judging/merged.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/judging/ruleChecks.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/refusals/record.ts
---
**Value.** The branch accumulates no new violations of the law: an agent can't commit a violation outside debt in any approval mode, yet doesn't get stuck on someone else's unfinished work.

**How.** The court of rules triggered before `submit_work` or `merge_worktree`, inside the landings themselves (code area); `watch` rules are named in the landing answer.

**Behaviour.**
- The tree the landing will actually publish is judged against HEAD; completing an open git merge — against each parent. `merge_worktree` judges against the base and carries accepted debt still standing at the branch's source tip, up to its counter; the branch's other violations stay new to the base.
- A gated-rule violation on the session's own lines refuses in trust, review, and bypass, and for any caller; the exits are fixing the code or loosening the law through `enforce_rule`.
- A violation on another live session's lines lands and is named with its holder; a violation an uncommitted colleague file will remove goes to them too.
- The refusal names the place, the norm, the place's own fix, the blocking rules' run times, and two exits: fix the code or record the violation as debt on a new task, with the `enforce_rule` call naming the failed landing's checkout (for merge — the branch's worktree).
- A violation inside debt passes.
- A changed enforced-key description measures the whole reach in the landing tree; the `rechecked` answer names findings outside debt. Standing code violating only the new description doesn't refuse the landing by itself; check_rules over the same change shows it together with debt. A later remeasure records standing findings as escapes with their origin.
- Every refusal is recorded and visible on the rule page.

**Limits.** An inspection that cannot judge leaves the landing unjudged with its failure; successful inspections still refuse real gated crossings. Each failed rule is recorded as unjudged in its graph history; an unreadable graph or tree names the gate's failure instead. Violations the landing let through become escapes after it.
