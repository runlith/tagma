---
id: 01a160c4-df6e-7856-9344-c35b686e5bcc
title: "Step 6 · An ESLint rule switches on into the gate on a dirty project: the old goes to debt on a task, the new is refused, debt shrinks on its own"
ord: 23
tags: ["experiment"]
fields:
  {
    "status": "done",
    "verdict": "confirmed"
  }
edges:
  - kind: relates
    to: 01a160c4-c0d7-7a70-a62d-eecf1151b625
  - kind: validates
    to: 01a14c14-a11c-7ce8-9d84-633588b4c33c
  - kind: validates
    to: 01a14c14-a11c-7ce8-9d84-633958074d0c
---
## Hypothesis

A rule on someone else's linter can switch on into the gate on a project where violations already stand, with no cleanup and no `eslint-disable`: the old becomes debt on an owning task and does not get in the way, the new is refused, debt shrinks on its own as fixes land.

## Setup

- law-lab at `fdcf041bb8`: ESLint 9.39.5, `tagma.config.ts` with the `no-console` key (`Linters.eslint().rule('no-console')`), rule [[4e5d1446]] on gate before submit_work, debt 0.
- The researcher thread does the steps itself: file tools, `enforce_rule`, `submit_work`, `read_enforcement`.

## Observation

1. **Dirty code.** `enforce_rule` → watch. Six `console.log` in `budget.ts`, `expenses.ts` (2), `App.tsx` (2), `Button.tsx`, commit `f0a328b7f0` landed, `watched` named 4 places. `read_enforcement`: escaped 4, debt 0. Rules: "Warns", "Slipped through 4" with "Ask an agent to fix" and "Keep as known…" buttons. An ESLint debt unit is a file and rule with a counter: six calls yielded four entries, only the file's first line shows in the list.
2. **Gate without cleanup.** Owning task [[83ae385d]]; `enforce_rule` gate, `absorb: all`, `owner` it: "debt: 0 → 4", escaped 0. Rules: "Blocks", "4 known ↑".
3. **New violation.** `console.log` in `money.ts` (no file in debt): `submit_work` → `refused[law-violated]`, one place `money.ts:17` named, check time 900 ms, two ways out — fix or record into debt on a new task. Debt stayed 4, a new place in Commits blocked.
4. **Debt leaves on its own.** `console.log` removed from `budget.ts` and `Button.tsx`, commit `474aa6948a` landed; the background re-measure (676 ms, about 5 s after the commit) dropped two entries: debt 4 → 2, history 0 → 4 → 2, Rules "2 known ↓".

Found along the way: post-`enforce_rule` and startup measurement wrote "0 ms" (fixed `2b5809bc76`, [[61ee8657]]); on the rule page the old refusal stands as the top news, a double period "statement.."; in the feed "Committing this session's own paths · law violated".

## Conclusion

- **Confirmed:** switching the gate on a dirty project with one `enforce_rule`, refusal only for the new, debt on a task, debt shrinking with no manual accounting; all visible on the Rules screen.
- **Tagma cannot tell apart:** the same four steps repeat with ESLint bulk suppressions plus hook ([[4ce8617e]]). What differs and what does not is in [[1151b625]].
- **Not checked:** a violation in a file already in debt beyond its counter; deleting the last entry and closing the owning task; behaviour of an agent rather than the researcher.
- **The user had to know:** that switching to watch is needed to commit dirty code; that `absorb: all` with an owner is the "Keep as known…" on screen.
