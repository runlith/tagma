---
id: 01a16156-a2b3-7183-bf29-78eb4f7ddd18
title: Step 9 · The same agent with the same norms in CLAUDE.md and a pre-commit hook solves the task the same as with Tagma's law
ord: 26
tags: ["experiment"]
fields:
  {
    "status": "done",
    "verdict": "refuted"
  }
edges:
  - kind: relates
    to: 01a160c4-c0d7-7a70-a62d-eecf1151b625
  - kind: relates
    to: 01a16152-2c20-7b1b-bc34-2148a7366c31
---
## Hypothesis

The same agent with the same task, receiving the same seven norms through `CLAUDE.md` and a pre-commit hook instead of Tagma's law, will violate more or fix at higher cost than in [[a7366c31]].

## Setup

- `/opt/workspaces/law-lab-plain`: the law-lab code as before the CSV commit (`bee87989dd~1`), no `.tagma`, `tagma.config.ts` or `checks/`, with a fresh git history (`ec45853`). Tagma project 41 with an empty graph, `rules.global.enabled = false`, `agent.contextFiles.enabled = true`.
- Norms as without Tagma: `CLAUDE.md` at the root, in `packages/domain`, `packages/ui`, `apps/web` — the same texts; `.githooks/pre-commit` → `checks/precommit.ts` (~50 lines: imports over allowed relations, ≤120 lines, re-export only in `index.ts`, a test for a domain module) + `checks/baseline.json` (4 entries) + ESLint `--suppress-all`. Trial: the hook refused a new domain file with no test and with a `console.log`. Setup took the researcher, who knew the norms, about 15 minutes.
- Agent [[01a16155-9e0d-7323-8144-7e42be626831|csv-plain]]: a native Tagma thread, claude-sonnet-5-5 high, the same task verbatim. Plain Claude Code never started: the plain profile needs its own config folder, while the logged-in ones carry Tagma hooks.

## Observation

- 15 entries, commit `3617c0f213` first try, the hook let it through.
- It read all `CLAUDE.md` files itself with one `cat` command before the first edit.
- Did the same as the agent with Tagma's law: `packages/domain/src/csv.ts` with a test, `ExportCsvButton.tsx`, in `App.tsx` +2 lines "to stay under the limit that has a baseline entry", no `console`, no `ui` import from domain; the amount formatting — its own again, in `csv.ts`.

## Conclusion

- **Confirmed:** on a plain task an agent with `CLAUDE.md` + hook behaves the same as with Tagma's law: the same decisions, the same violations bypassed, 0 refusals in both.
- **Refuted for this task:** Tagma's win in agent behaviour. Prevention comes from the rules' text in context, and `CLAUDE.md` gives it no worse.
- **What stays with Tagma but this run did not measure:** the Rules screen and history (a hook has neither), debt with owners instead of a JSON list, debt shrinking on its own, one mechanism for different checks; a shared checkout with several agents. That is value for the operator, not for agent behaviour.
- **Not checked:** plain Claude Code outside Tagma; a task where the agent violates and gets the refusal.
