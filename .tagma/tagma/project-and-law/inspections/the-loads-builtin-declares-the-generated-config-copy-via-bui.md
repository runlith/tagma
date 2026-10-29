---
id: 01a13fce-a13c-7b3d-9a03-7585288197fd
title: The `loads` builtin declares the generated-config copy via `built`, like `modules`
ord: 31
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a13f95-60fe-7047-a344-e33f81074aa9
sources:
  - kind: file
    ref: apps/tagma/inspection/src/packs/js/loads/implementation.ts
---
The `loads` builtin resolves bare specifiers through `workspaceOf`, which goes through the `paths` of the tsconfig nearest to `base`. When that config's `extends` points at a file missing from the judged tree (a generated config), `loads` falls with `InputAbsent` naming the file, but has no declaration to resolve it: only `modules` has `built`.

To do: `loads` takes `built` of the same shape and meaning as `modules` (output → committed source, why), passes it into the resolution context (`workspaceOf(…, builtOf)`), and the refusal names that parameter; the `built` schema and the refusal words live with one owner in `core/params`, not as a copy. Verification: a `loads` contract test on a tree whose tsconfig inherits a missing file — with the entry judgment proceeds, without it a refusal with the path.
