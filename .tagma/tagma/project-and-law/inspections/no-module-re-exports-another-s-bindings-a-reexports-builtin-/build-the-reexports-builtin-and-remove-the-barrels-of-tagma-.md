---
id: 01a0db81-eec7-7a8e-852a-8d107bece7df
title: Build the `reexports` builtin and remove the barrels of `@tagma/inspection` and `@runlith/code-facts`
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0db82-4d9f-7568-9d7f-3b45c0177709",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0db81-b8b3-7522-97cf-1b67dabecf26
---
Target 1 of [[dabecf26]], plus the barrels of the two packages that carry it. Start at `apps/tagma/inspection/src/{builtins,loads}.ts`, `node/implementations.ts` and `packages/code-facts/src/languages/js/imports.ts`. Done when: the builtin decodes, describes and reads through the same doors as `direction`/`loads`, `read_inspections` answers it, unit tests cover each forwarding form and an ordinary export, no re-export stands in either package, their consumers import the defining files, and typecheck plus tests of both packages and `apps/tagma/server` pass.