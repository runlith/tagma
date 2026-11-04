---
id: 01a1127c-0de7-756d-9029-75af208a6ab1
title: "submit_work builds and judges the tree once, in execute: any new gated-rule crossing refuses rule-violated in any mode and for any caller"
ord: 1
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/enforcement/judging/ruleChecks.ts
  - kind: file
    ref: apps/tagma/server/src/landing/land/commit.ts
---
Violations show only on the assembled tree, so the tree is built and judged once — in execute, where it commits (rule 2393aff1). Judgement knows no caller: neither the approval mode (`CallAuthority`) nor whether the caller is a Tagma thread or the operator affects it.

- **Any new gated-rule crossing in the tree that lands is a `rule-violated` refusal** in review, trust, and bypass, for a flow and for a flowless caller, whoever wrote the line; no file lands. A violation outside debt can be neither asked nor passed: law softens only through `enforce_rule`, and that is the way out the refusal's `unblock` names beside "fix the code".
- **The other writers of a crossing's line are information, not a verdict:** the refusal names them (`holders` of the crossing), and its ways out name neither waiting for them nor taking from them — fix it (a line whose writer no longer changes it is anyone's to fix), land without the file through `paths`, or leave your own lines in that file uncommitted.
- **A crossing counts as new by hunk:** in a changed hunk only occurrences beyond the ones the hunk removed are new, so a standing violation that moved inside a hunk is not.
- **A violation inside debt passes.** An inspection that cannot judge passes the landing as unjudged, with the failure in the answer and the rule's graph history. The successful inspections still refuse real gated crossings.
- **The refusal is recorded** (`kept` in `ruleChecks`) with the branch and the caller, so it can be read later.
- `submit_work` asks the operator only its ordinary review-mode confirmation; no state of another writer raises a question.
- The same `ruleChecks` path judges `merge_worktree`: a gated violation refuses there the same way, and `check_rules` over a change builds the same tree, so its `refuses` answers exactly when `submit_work` would refuse.
