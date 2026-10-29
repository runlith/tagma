---
id: 01a16152-2c20-7b1b-bc34-2148a7366c31
title: Step 8 · An agent with a plain task obeys a law of seven rules of different natures without reaching a single refusal
ord: 25
tags: ["experiment"]
fields:
  {
    "status": "done",
    "verdict": "unclear"
  }
edges:
  - kind: relates
    to: 01a160c4-c0d7-7a70-a62d-eecf1151b625
  - kind: validates
    to: 01a14c14-a11c-7ce8-9d84-633588b4c33c
---
## Hypothesis

An agent given a plain task in a project with a law of many rules of different natures will hit at least one of them at commit and fix itself per the refusal; the law works as one mechanism for all rules.

## Setup

- law-lab at `2a86d64600` + `#module` cards for `domain`, `ui`, `web` (`set_module`). Seven rules: [[18ad9402]] (`Loading.forbid`), [[4e5d1446]] (ESLint), [[a347f649]] (own program), [[13981632]] (`Imports.modules`), [[54911d80]] (`Files.maxLines` 120), [[1f4c22f7]] (`Code.noReexports`) — all Blocks before submit_work, debt 7 on tasks; [[7172a92b]] text only, `code` delivery on `apps/web`, `packages/ui`.
- Agent [[01a16150-a2b9-76a1-a1e2-34bf19053512|csv-export]], a Tagma thread in law-lab, claude-sonnet-5-5 high. Task verbatim: "Add an export of the selected month's expenses to CSV to the expense-tracking app: on the "Expenses" page an "Export CSV" button; pressing it downloads the file `expenses-<YYYY-MM>.csv` with columns date, category (in Russian), amount in dollars with cents, note. Commit it." (translated from Russian)
- Traps: `App.tsx` already 175 lines at the 120 threshold; amount formatting lives only in `ui`; a new file in `domain` needs a test.

## Observation

- 28 entries, 14 files read, one `submit_work` — landed first try (`bee87989dd`), 0 refusals.
- Before the first edit, in reasoning: "summary.ts already violates the domain/UI separation rule… domain code can't import UI utilities like formatCents, I'll create the CSV logic as a new file in domain with its own tests, checking existing conventions around Amount, console rules, and file length limits"; then "App.tsx is already near or over the 120-line limit, I'll extract the export button into its own ExportCsvButton.tsx".
- Did: `packages/domain/src/csv.ts` + `tests/csv.test.ts` (17/17), `apps/web/src/ExportCsvButton.tsx`, in `App.tsx` +2 lines, export from `index.ts`. Ran `bun test`, `tsc`, `eslint` itself.
- Re-measure after commit: debt 7 → 7, escapes 0. `App.tsx` grew inside its own debt, no refusal.
- Cents-to-dollars conversion written in `csv.ts` as the third copy (after `formatCents` in `ui` and `dollars` in `budget.ts`).

## Conclusion

- **Confirmed:** a seven-rule law reached the agent and was obeyed before the gate — six rules of different checks plus one as text; not a single refusal nor a new violation.
- **Not confirmed:** the reaction to a refusal — it never got that far again; this is the third run ([[deeaa110]], this one) where delivery fires ahead of the gate.
- **What it means:** prevention rests on the rules' text in the agent's context — what a nested `CLAUDE.md` would give too; here the gate is insurance, not the mechanism the agent sees. Tagma's distinction in this run is unmeasured: the same run without Tagma is needed.
- **Quality finding:** rules forbid but do not say where the shared code should live; the agent duplicates the money formatting for the third time. No rule catches that.
- **The user had to know:** the module map (`set_module`) and the config function signatures; `read_inspections` gave the wrong `Files.maxLines` signature ([[2838f20e]]).
