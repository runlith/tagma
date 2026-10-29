---
id: 01a1615a-8de0-7df8-ae01-1f6bb4797b1e
title: "Step 10 · Gate judges a commit by its own session's lines: someone else's violation does not refuse it, and lines landed whole become the author's escape with a message to them"
ord: 27
tags: ["experiment"]
fields:
  {
    "status": "done",
    "verdict": "confirmed"
  }
edges:
  - kind: validates
    to: 01a14c14-a11c-7ce8-9d84-633588b4c33c
---
## Hypothesis

In a shared checkout, the gate judges a commit by the committing session's lines: another session's uncommitted violating line in the same file does not refuse it; lines landed whole go in marked and become their author's escape, which they are told about; the escape leaves on its own when no violation remains.

## Setup

- law-lab at `cf9e867402`, rule [[4e5d1446]] (ESLint `no-console`) on gate, debt 2.
- The peer session [[01a16158-ce40-791e-baf7-4d9b075e0386|peer-writer]] (a mechanical edit) wrote `console.log` as the first line of `budgetStatuses` in `packages/domain/src/budget.ts` and did not commit. The researcher edits the `budgetLine` comment in the same file.

## Observation

1. `read_changes` on the file: "this session +1/−1 · 01a16158… +1/−0" — both sessions with their own lines.
2. `check_rules` over the researcher's change: "no violation", all 6 rules passed.
3. `submit_work` without `whole`: `1a7443468a`, with only the researcher's line in the commit, the peer's `console.log` stayed uncommitted.
4. A second edit in the same file, `check_rules whole: true`: the `budget.ts:43` violation with "held by 01a16158…", no `refuses`. `submit_work whole: true` → `6451d9489b`, "went in whole, with lines of 01a16158…", `carried violations (1)` with the holder.
5. `read_enforcement`: escaped 1 "@ 6451d9489b held by 01a16158…". The peer's thread received the signal "A line the change record holds as yours crossed 4e5d1446 and landed in 6451d9489b… with another session's commit", with a fix and a way out through debt.
6. The line removed, commit `ea16b92a44`; re-measure: escaped 0.

## Conclusion

- **Confirmed** everything in the hypothesis: judgement by one's own lines, marking on a whole landing, escape on the author, message to the author, escape removing itself.
- **Defect:** the signal's text says "raises law-escaped" — the `law-escaped` signal was lost when `law-*` was renamed; handed to an agent as a task by [[01a1615a-3400-702f-a251-9aa8644d2eaa|escaped-signal]].
- **Not checked:** the signal arrived in a thread whose run had already ended — whether it wakes it or waits for its next run; the Rules screen for a holder-owned escape.
