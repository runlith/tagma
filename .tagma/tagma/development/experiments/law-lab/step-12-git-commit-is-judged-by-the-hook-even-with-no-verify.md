---
id: 01a16160-60b0-7b2c-9a16-36d6e8ce86ef
title: Step 12 · git commit is judged by the hook even with --no-verify; a commit past all hooks goes unnoticed until the next landing
ord: 29
tags: ["experiment"]
fields:
  {
    "status": "done",
    "verdict": "unclear"
  }
edges:
  - kind: validates
    to: 01a14c14-a11c-7ce8-9d84-633588b4c33c
---
## Hypothesis

An ordinary `git commit` in the project's checkout is judged by the same rules as `submit_work`; a commit that bypassed judgement is found by Tagma and recorded as a holderless escape.

## Setup

law-lab at `89547a9`, rule [[4e5d1446]] on gate before `submit_work` and `merge_worktree`. `console.log` added to `money.ts`, `git add`.

## Observation

1. `git commit`: the Tagma hook — `tagma: refused[rule-violated]` with place `money.ts:12`, time 661 ms, `said` "Blocked by rule …" and ways out (fix, `git restore --staged`, absorb). No commit.
2. `git commit --no-verify`: the same refusal — judgement stands in `prepare-commit-msg`, which `--no-verify` does not skip.
3. `git -c core.hooksPath=/dev/null commit`: commit `47266de` landed.
4. `read_enforcement` minutes later: "measured at 4b61f25 … escaped 0" — the violation on HEAD is invisible, the Rules screen says nothing slipped through.
5. A harmless landing `b17723fab9`: the re-measure recorded the escape `money.ts:12` with no holder, but "@ b17723fab9" — the commit that found the violation, not the one that introduced it.
6. The hook's `git commit` refusals are not recorded in the rule's `refusals` (so described in the rules skill).

## Conclusion

- **Confirmed:** `git commit` is judged, and `--no-verify` does not bypass judgement.
- **Defect:** a commit past all hooks goes unnoticed until the next landing or restart; the found escape is attributed to the wrong commit. Handed to [[01a1615f-c300-76fe-a50c-94a0ed82f7e5|head-move-measure]].
- **Left open:** `git commit` refusals are not visible on the rule's page under "Commits blocked" — by description a choice, but the operator will not see that a person hit the rule.
