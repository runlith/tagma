---
id: 01a16131-3b53-7908-ab94-581f99fcd7c2
title: Step 7 · A project norm no linter expresses is judged by a project program on par with ESLint
ord: 24
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
    to: 01a14c14-a11c-7ce8-9d84-633958074d0c
  - kind: validates
    to: 01a14c14-a11c-7ce8-9d84-633b841d0f08
---
## Hypothesis

A project norm expressed by neither a built-in check nor a linter can be made a check by a project program, and it gets the same as an ESLint rule: debt with an owner, gate, a refusal with `fix`, time, history and the Rules screen.

## Setup

- law-lab at `d63ba9dd0d`; the norm — every `packages/domain/src` module has its own test `packages/domain/tests/<name>.test.ts`, `index.ts` excluded. `read_inspections` over law-lab: 11 functions, no "file ↔ file" pair check among them.
- The researcher thread does the steps itself; it writes the program too, from the norm the operator said in one phrase.

## Observation

1. **Program.** `checks/inspections.ts` (`defineInspection`, concern `code`) and `checks/programs.ts` (`defineProgram`, about 30 lines: module name from changed paths, source–test pair, `fingerprint` `untested <path>`, `message`, `fix`); the `domain-tested` key with params and `files` in `tagma.config.ts`. `check_rules` over the change: the config computes, 0.1 s. Commit `e6d5755640`.
2. **Measurement.** `check_rules over all`: exactly `money.ts` and `summary.ts`, each with its own `fix`, 1.5 s.
3. **Gate.** Rule [[a347f649]] with the `packages/domain` source, task [[2cf5b688]]; `enforce_rule` gate before submit_work: "debt: 0 → 2", 0.2 s.
4. **New violation.** When writing `rates.ts` the rule reached the researcher by `code` delivery. `submit_work` → `refused[rule-violated]`, place `rates.ts`, `fix` "Add packages/domain/tests/rates.test.ts…", "ran in 219 ms", `said` "Blocked by rule "…"". Test written per `fix`, `bun test` 1 pass, commit `f1149079a6` landed; `read_enforcement`: debt 2, the refusal recorded with `fix`.

The rule's shared hint for places without their own `fix` — "Remove it where tested's message points." — reads poorly; this program has no such places.

## Conclusion

- **Confirmed:** a project program is a check with equal rights: the same debt, gate, refusal, time, history and screen as ESLint and built-ins; a program owes only `findings`.
- **Not a Tagma distinction on a single rule:** the same script on a pre-commit hook with its own exclusion list an agent writes in minutes, and a norm in words next to code is given by a nested `CLAUDE.md`. A person does not write the program code either — an agent does; trust in it is held by the measurement before switching on and a trial violation, not by reading code. What the measurement does not show: what the program lets through (here — nested `src` folders).
- **Not checked:** a rule in the bigger picture of many rules of different natures — the only place where Tagma can beat a set of scripts ([[1151b625]]).
- **The user had to know:** that a program makes the norm a check and what it looks like — in the product that is the "Text only → Blocks → have an agent find a check" path on the Rules screen, not walked in this run.
