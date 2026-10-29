---
id: 01a1127c-0de7-756d-9029-75af208a6ab1
title: "submit_work builds and judges the tree once, in execute: a gated-rule violation is a rule-violated refusal in any mode and for any caller"
ord: 1
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/enforcement/judging/ruleChecks.ts
  - kind: file
    ref: apps/tagma/server/src/landing/land/commit.ts
---
Violations show only on the assembled tree, so the tree is built and judged once — in execute, where it commits (rule 2393aff1). Judgement knows no caller: neither the approval mode (`CallAuthority`) nor whether the caller is a Tagma thread or the operator affects it.

- **A gated-rule violation on the calling session's lines is a `rule-violated` refusal** in review, trust, and bypass, for a flow and for a flowless caller; no file lands. A violation outside debt can be neither asked nor passed: law softens only through `enforce_rule`, and that is the way out the refusal's `unblock` names next to "fix the code".
- **Automatically taken dependent lines of another session are judged as part of the caller's delivery:** a new gated violation refuses `rule-violated`. Explicit `whole` and a program file preserve the holders' attribution outside `taking`; a violation on such lines lands as `carriedViolations`. Lines of holders from `taking` are judged as the caller's own delivery. This is the judgement's decision, not the mode's.
- **A violation inside debt passes.**
- **The refusal is recorded** (`kept` in `ruleChecks`) with the branch and the caller, so it can be read later.
- The operator's questions about others' lines concern their own lines and explicit `taking` of a running session; an idle peer's standing alone needs no question.
- The same `ruleChecks` path judges `merge_worktree`: a gated violation refuses there the same way.
