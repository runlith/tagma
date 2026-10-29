---
id: 01a156ee-85b8-7fb5-ad25-ad08e6563db1
title: runlith and polygon law moves into `tagma.config.ts` with no lost or gained debt
ord: 10
tags: ["task"]
fields:
  {
    "holder": "tagma:01a157af-c264-71d8-bad6-c70b3c637e03",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a156d9-a73e-7045-bbfd-b087b6f7a4e0
  - kind: waits-on
    to: 01a156ee-85b8-7fb5-ad25-ad06987d0e6e
  - kind: waits-on
    to: 01a156ee-85b8-7fb5-ad25-ad070b391840
sources:
  - kind: file
    ref: checks/law/programs.ts
  - kind: file
    ref: tagma.config.ts
---
Migration items 1–2 of [[b6f7a4e0]]: runlith's `tagma.config.ts` with 19 keys from the graph step and the `oxfmt` format command; `checks/builtins.ts` for `names` and `platforms`; `checks/law/*` on `defineInspection`/`defineProgram`; the same for polygon. Old `tagma.jsonc`, `runners.json` and the `program.ts` protocol stay until the operator restarts the server (migration item 5).

Proof is [[b6f7a4e0]] acceptance item 1 on its own `tagma:try` instance: the same violations under 19 rules, the same debt of rule [[6b3210c7]], 0 escapes.

## Outcome (runlith `a66fa63ae7`, polygon `58787c3579`)

runlith's `tagma.config.ts` carries the graph step's 19 keys and `oxfmt` from `tagma.jsonc`; `names` and `platforms` are described in `checks/builtins.ts`, `swallowed-failures` allowances in `checks/failures.ts`; the light side of custom inspections is `checks/law/inspections.ts`, the program is `checks/law/programs.ts` (`migrations` and `step-places` answer `covered: 'reach'`). Each description's canonical form after decoding with the builtin schemas (for programs, parameters as they are) matches the rule document in `.tagma`. polygon: the `float` key, `tools/inspections.ts` and `tools/programs.ts`. Old `tagma.jsonc`, `checks/runners.json`, `checks/law/program.ts`, `tools/money.js` and `tools/runners.json` stand until [[20004d73]].

Comparing `check_rules over: all` on code `a66fa63ae7`: the live server with old-shape documents against its own `tagma:try` on build `a66fa63ae7` after the `20261020060000_rule_inspections` graph step and the first remeasure of all 19 rules (on an empty commit over the same tree).

| Rule | Key | Violations before | after | Debt before → after | Escapes before → after |
| --- | --- | --- | --- | --- | --- |
| 4657a163 | call-services | 0 | 0 | 0 → 0 | 0 → 0 |
| 373e29e4 | effect-style-373e29e4 | 0 | 0 | 0 → 0 | 0 → 0 |
| 01ba3d55 | effect-style-01ba3d55 | 0 | 0 | 0 → 0 | 0 → 0 |
| d270a238 | effect-style-d270a238 | 0 | 0 | 0 → 0 | 0 → 0 |
| 673f881b | effect-style-673f881b | 0 | 0 | 0 → 0 | 0 → 0 |
| bc8f1e15 | effect-style-bc8f1e15 | 0 | 0 | 0 → 0 | 0 → 0 |
| df923180 | effect-style-df923180 | 0 | 0 | 0 → 0 | 0 → 0 |
| 8fcfef49 | effect-style-8fcfef49 | 0 | 0 | 0 → 0 | 0 → 0 |
| 999bf9fa | environment | 0 | 0 | 0 → 0 | 0 → 0 |
| 925aed1c | loads-925aed1c | 0 | 0 | 0 → 0 | 0 → 0 |
| 0d2c66a9 | loads-0d2c66a9 | 0 | 0 | 0 → 0 | 0 → 0 |
| d81b1676 | migrations | 0 | 0 | 0 → 0 | 0 → 0 |
| 083d37f1 | modules | 0 | 0 | 0 → 0 | 0 → 0 |
| 6b3210c7 | names | 14 (all in debt) | 14, same | 14 → 14 | 0 → 0 |
| 50520d64 | platforms | 0 | 0 | 0 → 0 | 0 → 0 |
| 8183e6ef | reexports | 0 | 0 | 0 → 0 | 0 → 0 |
| a4d62ee7 | step-places | 0 | 0 | 0 → 0 | 0 → 0 |
| ea465bed | swallowed-failures | 0 | 0 | 0 → 0 | 0 → 0 |
| 55b5437b | ui-tokens | 0 | 0 | 0 → 0 | 0 → 0 |

- Violations matched line by line: rule, fingerprint (for programs after namespace), file, line, value, `owed`. 120 unjudged at `swallowed-failures` are identical before and after; these are places the inspection could not judge, not proven-clean ones.
- Debt of [[6b3210c7]]: 14 entries with the same fingerprints, owners (e239d4dc ×9, 2ea22ce5 ×2, b24693d3, 4b32fa34, 8261e893) and values.
- Escapes: 0 at all 19, before and after. At 083d37f1 the live server on this machine shows 0 escapes, not 2.
- Since programs have no findings at HEAD, the old `program.ts` and the new runner with `programs.ts` were run directly against historic trees (`1a93487` vs `1a93487~40`, both sides, whole reach): findings and coverage matched over all 11 program keys, including non-zero ones (effect-style 2/65/242/14/59/255/108, environment 110, migrations 11 per side). One timing sample: 10.0 s vs 9.1 s.
- polygon: a live `check_law over: all` from another home's thread does not run the program (`terminal-foreign-project`, reflection [[3574d045]]), so the comparison was made on one change: its own instance's gate on the `float` key and the old `tools/money.js` gave the same two findings `src/discount.ts × …`; at HEAD there are no violations in either.

Checked: `bun run typecheck` in `checks/law` (now also covering `tagma.config.ts`, `checks/builtins.ts`, `checks/failures.ts`) with no errors; `checks/law` tests — 57 pass, `migrations.itest.ts` — 2 pass; `programs.itest.ts` drives the Tagma runner with `programs.ts` on both sides in change and reach. A gpt-6.1-sol xhigh review found no remarks.

Not proven: program change-mode on runlith's live commit is proven only by the integration test; landings on the config start on the operator's server after its restart.
