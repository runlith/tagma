---
id: 01a164cf-e57f-7934-ae6f-58116e656652
title: Step 14 — debt accepted in a worktree rides to main through merge_worktree
ord: 32
tags: ["experiment"]
fields:
  {
    "status": "done",
    "verdict": "confirmed"
  }
---
**Hypothesis** — a violation refused by the gate in a worktree is accepted into debt right there via the refusal's `unblock` and rides to main through `merge_worktree` without refusal.

**Setup** — law-lab (project 39), worktree `absorb-wt` off `85c00f08`; rule [[4e5d1446]] gate before `submit_work` and `merge_worktree`, revision `ae4bb3b19903`. Caller — a thread with a runlith home. Server restarted by the operator after `4e2b54291a`, `cfda324355`, `031afc6c72`, `2095e55976`.

**Observation**
- First attempt (before fixes): `enforce_rule` measured main and refused `inspection-failed`, then with `checkout` — `not-found`; the owner could not be created in the worktree graph. Reflections [[d6d91cfd]], [[1fda09d8]].
- After restart: `submit_work` in the worktree refused `rule-violated`, `unblock` names `enforce_rule … checkout "<worktree>" absorb [...]`.
- `create_block` with `checkout` created owner [[f628abf1]] in the worktree graph.
- `enforce_rule` with `checkout` and `absorb`: debt 2 → 3, worktree graph; `submit_work` landed `e3c5ab1c78`, graph auto-committed (`8321e30`).
- `merge_worktree` → merged (`67eb95f6c4`), graph carried; in main debt 3, the `rates.ts` entry under f628abf1, escaped 0.
- Fix in main (`251741e20c`) — task closed.

**Conclusion** — confirmed after four fixes. Not checked: accepting into debt when both the branch and main changed the graph since branching. Noticed, not investigated: the debt history in main does not show the 18:10 step (last entry 02:40).
