---
id: 01a151df-e920-73d7-9b09-09e1887f5f71
title: Old rollout-copy forms are brought into shape by form steps, and import knows one form
ord: 16
tags: ["task"]
fields:
  {
    "holder": "tagma:01a151fc-567a-72f4-83ce-3134e2c0b824",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a151df-e920-73d7-9b09-09d091976ebe
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/rollout.ts
  - kind: file
    ref: apps/tagma/server/src/threads/journal/rolloutMeta.ts
---
Rollout import fixes old forms right in the reader: `fromLegacy` (`threads/journal/rolloutMeta.ts:192–252`), plus `explicitShape`, `legacySession`, `seated` and the `"why":"legacy-row"` replacement (`external-harnesses/rollout.ts:20–184`). Every next form change adds another branch there. Journal form steps already bring rollout meta into shape (`threads/journal/formSteps.ts`, the steps themselves live in the modules' `steps/`).

Do: these fixes become form steps in their own modules' `steps/`, in form-appearance order; the import reader knows only the current form; a copy still arrives at rest.

Proof: an import test of rollout files of every old form gives the same core row, binding, capabilities, model choice and facet as today; `fromLegacy`, `explicitShape` and `legacySession` do not occur outside `steps/`.
