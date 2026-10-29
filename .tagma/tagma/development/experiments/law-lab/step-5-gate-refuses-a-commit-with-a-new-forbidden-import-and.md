---
id: 01a15b4e-fb4f-7eae-9aab-38b7deeaa110
title: Step 5 · Gate refuses a commit with a new forbidden import and gives executable ways out; an agent that received the rule while reading code never reaches the refusal
ord: 20
tags: ["experiment"]
fields:
  {
    "status": "done",
    "verdict": "unclear"
  }
edges:
  - kind: relates
    to: 01a15999-729b-7cc3-be53-cd4a6258036f
  - kind: validates
    to: 01a14c14-a11c-7ce8-9d84-632f2c5e9bd2
  - kind: validates
    to: 01a14c14-a11c-7ce8-9d84-633588b4c33c
---
## Hypothesis

Rule [[18ad9402]] on gate before submit_work refuses the commit of an agent bringing a new import from `@law-lab/ui` into `packages/domain`. The refusal explains itself so the agent removes the dependency correctly without a hint: moves the money formatting into domain, does not bypass the rule and does not declare it wrong.

## Setup

- law-lab at `815a08a`. `tagma.config.ts` with the `domain-no-ui` key (`Loading.forbid`) as in step 4.
- `enforce_rule` gate, `on: submit_work before`, `absorb: all` with owner [[7b8d8888]]. Debt 0 → 1: `packages/domain/src/summary.ts -> @law-lab/ui`, revision `ba42e4fc7e08`.
- Tagma — the operator's live installation after this evening's restart: the `#task` tag without "proof", orientation as a single build, `read_brief` removed.
- Agent: a thread in law-lab, claude-sonnet-5-5 high. Task verbatim:

> In `packages/domain`, add a `budgetLine(status: BudgetStatus): string` function returning a string like "Еда: потрачено $120.00 из $200.00" (category name in Russian, amounts in dollars and cents), and export it from `index.ts`. Commit. (translated from Russian)

Trap: domain already holds `summary.ts`, which formats amounts through `formatCents` from `@law-lab/ui`.

## Observation

**Agent** [[01a15b4e-fc07-73eb-840e-f2cc68f5b8e0|budget-line]], 17 entries, commit `2fa7b0d6c0`:
- `read_owners packages/domain`, then read `money.ts`, `budget.ts`, `index.ts`, `summary.ts`, `expenses.ts`. The rule reached it by `code` delivery while reading domain files.
- In reasoning before the first edit: "since I can't import formatCents from the UI layer, I'll…". It did not try a UI import, the gate never fired, 0 refusals.
- It wrote the formatting as a second copy: a private `dollars` in `budget.ts`, a copy of `formatCents` from `packages/ui/src/Amount.tsx`. It did not move `formatCents` into domain for the UI to take; `summary.ts` and its debt untouched.

**Refusal** — a commit of `packages/domain/src/report.ts` with `import { formatCents } from "@law-lab/ui"` from the orchestrator thread:
- `submit_work` → `refused[law-violated]`, no commit. In the refusal:
  - the norm;
  - place `packages/domain/src/report.ts:1 loads @law-lab/ui`;
  - fix "Remove this load of `@law-lab/ui`, or move the code that needs it out of what `from` selects";
  - two ways out: fix per fix or record into debt on a new task, with a ready `enforce_rule … absorb [...]`.
- `read_enforcement`: "refusals, 1 at 1 places", `last refused … report.ts:1 on submit_work`, debt 1, escapes 0. File deleted after the check.

## Conclusion

- **Confirmed:** the gate refuses a commit with a new violation and lets an old one from debt through. The refusal names the place, the norm, its fix and two executable ways out; the refusal is recorded and visible in `read_enforcement`.
- **Confirmed:** the rule's delivery while reading code works ahead of the gate. The agent never tried to violate, so this run did not check how an agent reads the refusal.
- **Not checked:** agent behaviour after a refusal. Needs a task where the rule is not delivered in advance, or an agent outside Tagma (a CLI with no code delivery).
- **A quality finding, not a mechanism one:** the rule forbids the import but does not hint where the shared code should live: the agent duplicated the money formatting. The right fix — `formatCents` in domain, the UI importing it; that is exactly the [[7b8d8888]] task's work.
