---
id: 01a165f5-6330-7c0a-adac-04d931fc7826
title: "Step 22 — live re-verification: tightening visible before commit, delivery warning, update_block refusal, debt history after merge"
ord: 40
tags: ["experiment"]
fields:
  {
    "status": "done",
    "verdict": "confirmed"
  }
---
**Hypothesis** — the fixes after steps 19–21 work on the live server after the operator's restart on 22.10 ~23:30Z.

**Setup** — law-lab (project 39), HEAD `718a892919`; rules [[54911d80]], [[1f4c22f7]], [[4e5d1446]]. Commits `aaaf08205c`, `40e3c3d64c`, `bb250ccbfa`, `9f5cef250e`, `90e942f26d`. Caller — a thread with a runlith home.

**Observation**
- Tightening 120 → 50 uncommitted: `check_rules` over the change — 3 places across the whole coverage: `App.tsx` 192 "— debt", `seed.ts` 56, `expenses.ts` 83. Config restored, never committed.
- `set_rule_delivery code` for a rule without sources → `warning: Code delivery has no sources: this rule reaches no agent. Any enforcement still measures the whole project…`. Restored to prompt.
- Switched-off rule: `enforce_rule` → `rule-disabled`, unblock "`set_rule_enabled … with enabled true`". `update_block fields {enabled:true}` → `operation-only`. `set_rule_enabled true` — switched on, law delivered.
- Debt history: worktree `history-check`, task creation and absorb with WT checkout, `submit_work`, `merge_worktree` (after delete). In main: "3 at 23:31:56" a new mark, "2 at 21:53:43" and all earlier ones unchanged, `was 2 until 23:31:56`; entry `rates.ts → f262545d`, escape 0.
- Fix in main `a0ae7d7036`, `finish_block` — no "remaining debt".
- A parallel packet of acts in law-lab after the law change tripped `instructions-unread` (all but one) — behaviour by contract: the law changed in the same step.

**Conclusion** — confirmed: all four fixes work live. Not checked: an honest cancellation text when the server stops (needs a stop mid-call), review, `commit_checkout`.
