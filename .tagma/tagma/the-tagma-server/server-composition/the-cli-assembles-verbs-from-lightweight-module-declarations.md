---
id: 01a16e40-d218-7720-bdbe-05183bf7e3af
title: "The CLI assembles verbs from lightweight module declarations, not manifests: a manifest loads the whole module code"
ord: 25
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a16e37-8d17-7b78-bc1a-de5bc4fdb83b
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/cli/core.ts
  - kind: file
    ref: apps/tagma/server/src/composition/cli/verbs.ts
---
A module manifest (`<module>/<module>.ts`) imports the module's whole code: its `lifetimes` are Layer values, not lazy references. If the CLI assembled verbs from `MODULES`, every `tagma` launch would load nearly the whole server; `tagma check --gate`, which the commit gate calls on every `git commit`, loaded ~1170 modules that way and cost ~1 s CPU. So the CLI builds the table from the build descriptor's `verbs` (`CORE_VERB_MODULES` plus the build's own modules), which imports the modules' lightweight verb declarations (`<module>/cli.ts`; for checkout-builds and release-channel — `verbs.ts`, because their `cli.ts` is the verbs implementation itself). Module code loads only in the loader of the verb being launched.

The verbs declaration is still one — the function the module puts in its manifest's `verbs`; the CLI table holds that same function, not a copy. That the two lists match by id, module order, and function identity for the developer and release builds is checked by `composition/cli/verbs.test.ts`: a new verb in a manifest without a table row, or a row without a verb in a manifest, fails it. The module order in the table is the `MODULES` order; the verbs order in `tagma --help` depends on it.
