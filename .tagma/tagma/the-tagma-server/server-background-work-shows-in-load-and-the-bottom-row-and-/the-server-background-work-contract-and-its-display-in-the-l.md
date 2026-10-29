---
id: 01a14f27-81e3-7e65-9965-4c79dc2700cb
title: The server background-work contract and its display in the Load feed, panel, and bottom row
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14a05-5a4d-76a0-b1af-97cb761579da",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a14f27-655b-7b9c-a4a5-f8d22d498c2b
sources:
  - kind: dir
    ref: apps/tagma/server/src/executions/load
---
Item 1 of [[2d498c2b|spec]]: a background-work owner with CPU and estimate, the `executions/load` feed, `LoadButton`/`LoadPanel`, wiring journal migration, edit re-judgement, graph catch-up, and rule remeasure. Proof is spec acceptance 4 and 5.

## Result (6fffb4f85e)

- The `platform/background.ts` owner under the `Background` tag (`run` with progress, `standing` with a last-minute-pace estimate; work under 3 s invisible, the declaration removed on any outcome). `LoadView.background` and the `read_machine_load` answer carry the list; `LoadButton` shows the label, `LoadPanel` the "Background work" group.
- `ThreadRollout.formLagging` (with volume), `Retirer.pass`, and `enforcement.remeasures` (without volume) wired.
- Checks: `platform/background.test.ts` unit, Load tests, `checks.test`, 15 itest on the affected fixtures (63 pass), `formSteps.itest`, `shelf.stest`; server and app typecheck clean in the affected places.

Not proven: the live view on `tagma:try` (acceptance 4) was not checked; graph catch-up after restart not wired; per-job CPU not shown — the reason is in the spec. No independent review: the thread has delegation off.
