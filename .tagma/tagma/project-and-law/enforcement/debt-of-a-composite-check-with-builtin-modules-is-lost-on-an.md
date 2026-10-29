---
id: 01a12d44-bb95-7401-bd2d-99c6a081a6b9
title: Debt of a composite check with builtin `modules` is lost on any module-map change
ord: 34
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12c9f-ec67-7e4f-be87-4300b1d6bd43",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/enforcement/programs/bindings.ts
---
`judgeBindings` prefixes a builtin-check fingerprint with the hash of `canonicalJson(binding)` (`enforcement/programs/bindings.ts`), and by then the binding is already assembled together with the module map (`contract/wire/document.ts`, `assembled(binding, reading.map)`). Any `set_module` changing the map changes the prefix: the whole debt of such a rule goes retired, the same violations go escaped. Affects only rules with a bound inspection where one of the builtins takes the map; rules with a single `modules` carry debt over (including across id renames — `renamedModuleDebt`).

Found by reviewing the fix of reflection 985d3804 (graph `tagma`). Start by computing the prefix from the stored binding without the map; stored debt of such rules migrates in one step. Done when `set_module` over a rule with a bound inspection including `modules` keeps debt in place (an itest next to `composition/testing/enforcement/modules.itest.ts`, red before the fix).
