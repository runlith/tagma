---
id: 01a13f63-559c-7cb3-89b6-c44589db761e
title: "Law reflections: enforce_law, check_law and inspection defects"
ord: 41
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13f64-c077-73c7-96db-36b69c496408",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/enforcement/rules/enforce.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/voice.ts
  - kind: file
    ref: apps/tagma/server/src/invocation/contract/service/input.ts
  - kind: file
    ref: packages/llm/src/llm/protocols/openai-chat.ts
  - kind: file
    ref: packages/llm/src/llm/protocols/openai/lower.ts
  - kind: file
    ref: packages/llm/src/llm/protocols/utils/tool-schema.ts
---
Fifteen law reflections triaged. First delivery — explicit bugs with no API change; second — on the operator's word "go and fix everything", with the right to change contracts.

## First delivery: `6c1348eb95`, review fixes `edda7085c9`
- [[61e832ec|Lost base null]]: OpenAI request builders keep nullable tool schemas.
- [[8a9cb8d8|Absorb from working tree]] and [[f6252b3d|unknown fingerprints]]: direct enforce_law refuses before writing, naming HEAD-missing fingerprints present at measurement.
- [[c4b5b460|Wrong unknown field]] and [[0dd31ced|update-server advice]]: input decoder keeps the schema failure with union parameter paths.
- [[998580b7|Hidden staged refusal]]: an index-read refusal prints together with watch findings, unjudged and cursor.

## Second delivery: `31ce1e5e9a`, `cad268620b`, review fixes `997dfd2e39`
- [[b5b96da3|Ambiguous allowance]]: `swallowed-failures.allow` identity is `path, symbol, form, site`; `put` changes exactly the site, `drop` requires the site.
- Testing entry via cut: an import inside its own module isn't an entry crossing; rule [[083d37f1|on modules]] clarified: another module's `testing` entry holds only test code.
- [[5740e365|Effect-style via check_law]]: `check_law.inspection` accepts `{ bindings: [{ runner, id, … }] }` of project programs through the existing `checkWith` chain.
- [[d86aeced|Full patch answer]]: `enforce_law` answers with ids of checks, debt/escaped counters, the applied patch and `measured`.
- [[3803d570|Full patch remeasure]]: a file-local list patch whose records name a file (`recordList(…, 'path')`) reads only those files in the worker's exact-path mode; ledger outside them stands as it was, file ownership of debt comes from `Measurement.sources`, no measurement identity is written, the landing driver doesn't fork a full remeasure. Full instead of point: no own measurement with sources, a patch path added or removed after it, or a patch changing strictness, triggers, absorb, owners, module map.

## Second-delivery review
Sol xhigh and two Muse xhigh lenses (ledger, wire). Fixed: ambiguous debt-to-file attribution by fingerprint token (now an exact source from the verdict, the `rules/ledger.ts` colleague fix-small-tasks), lineage loss when moving a path between partial and full measurement (rollback to full), regional listing/grep on point patch (exact-path `paths`), modules hint about its own `testing` entry, schema doubles of bindings, the `paths:` label in the answer, `path` ∈ identity in `recordList`, `renamedModules` excludes partial; a retire test inside paths and rollback after a move. Rejected: a rule with an empty `on` wasn't remeasured by the driver even before this delivery; add/remove outside paths between prepare and execute doesn't touch the glued ledger part; duplicate escapes unreachable with one file per fingerprint; refusal texts aren't pinned by tests; `measured` at `off` doesn't differ from other measurementless answers.

## Outside the task
- [[f564b376|Generated tsconfig]] handed to a separate implementer.
- Not reproduced, unanswered: [[2badeaf8|symlink outside reach]], [[560a23b2|CLI measured rules]], [[3df08a75|produced-directory BadResource]].

## Checks
- `enforceLocal.itest.ts` 2/0: a patch doesn't write off debt that disappeared outside paths (a full measurement does), writes off debt it resolved itself, and goes to a full measurement after a path move.
- After review: `enforceWrite.itest.ts` 10/0 (including the real `checks/law/program.ts` effect-style), `enforce.itest.ts` 9/0, `enforcePatch.itest.ts` 5/0, enforcement unit 64/0, inspection modules+effect 76/0.
- `bun run typecheck`: no errors in delivery files; the rest — in teammates' rewritten `doorFixture.ts` and http tests.
- HEAD `997dfd2e39` imports `rules/ledger.ts`, which the uncommitted fix-small-tasks still holds; until it lands HEAD doesn't build (the working tree does).
