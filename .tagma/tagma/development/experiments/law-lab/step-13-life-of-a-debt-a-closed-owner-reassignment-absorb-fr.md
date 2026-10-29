---
id: 01a1616b-2f1a-71a8-98f8-391bd2876ab4
title: "Step 13 — life of a debt: a closed owner, reassignment, absorb from a refusal"
ord: 30
tags: ["experiment"]
fields:
  {
    "status": "done",
    "verdict": "confirmed"
  }
---
**Hypothesis** — a debt survives its owner's closing visibly, is reassigned without loss, and a violation from a gate refusal is accepted into debt via the refusal's `unblock` and leaves debt as soon as the code is fixed.

**Setup** — law-lab (project 39), HEAD `3b1c835c9e`; rule [[4e5d1446]] "There is no `console` in the code", gate before `submit_work` and `merge_worktree`, revision `ae4bb3b19903`, debt 2 on [[83ae385d]]. I did everything myself with operations, no agent in the polygon.

**Observation**
- The escape from `47266de` after `3b1c835c9e` vanished: `escaped 0`.
- `close_block` of the owner passed without a word about the debt. `read_enforcement`: `owners: 83ae385d ended closed (2)`, debt 2, escaped 0; the Debt screen says "ended, needs a new owner".
- `enforce_rule` with `owners` to a new [[440f9e38]]: debt 2 → 2, owner changed, revision the same (it tracks strictness, triggers and inspection).
- `console.warn` in `rates.ts` → `submit_work` refused `rule-violated`; the second `unblock` gives a ready `enforce_rule 4e5d1446 absorb ["no-console packages/domain/src/rates.ts"]` call.
- New task [[fe0d8435]], absorb of the uncommitted fingerprint → debt 2 → 3; `submit_work` landed `4cc50ffb9e`.
- Line removed, commit `e232773e5e` → re-measure in ~10 s dropped debt 3 → 2; the owning task stayed open, I closed it myself.

**Conclusion** — confirmed: debt with a closed owner stays debt and is marked, reassignment and absorb from a refusal work in one call, a fix drops the debt on its own. Gap: whoever closed the owner learns nothing about the abandoned debt — handed off as a separate task. Not checked: absorb in a worktree and at `merge_worktree`.
