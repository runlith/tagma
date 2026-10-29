---
id: 01a14c14-a11c-7ce8-9d84-633c89123986
title: Module boundaries are written on cards, and a map change at once remeasures the rules that judge by it
ord: 9
tags: ["feature"]
fields:
  {
    "state": "live"
  }
sources:
  - kind: dir
    ref: apps/tagma/inspection/src/packs/architecture/modules
  - kind: file
    ref: apps/tagma/app/src/lib/features/rules/Modules.svelte
  - kind: file
    ref: apps/tagma/server/src/enforcement/rules/moduleMap.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/rules/modules.ts
---
**Value.** The project's architecture — who may import whom — lives in the graph beside module knowledge, and changing it at once shows how many violations it opens or closes.

**How.** `#module` cards; `set_module` creates, moves, and deletes cards and changes their id, root, cutouts, entries, relations, and floors; `read_inspections` with a map answers with the whole map and what keeps it from converging.

**Behaviour.**
- Collections change pointwise — add, remove — or wholesale; a module reference is accepted by id or card name, as `read_block` shows them.
- Paths named by the call must stand in the working tree; all request errors are named by one refusal, and nothing is written.
- `preview: true` measures the proposed map on HEAD and returns the debt change and escaped fingerprints without writing cards or enforcement. A normal call remeasures and writes them together; the answer starts with the count and the first escaped fingerprints of each remeasured rule. A map or HEAD shift between preparation and write requires calling the operation again. A map failing the inspection's conditions refuses with its `module-map-invalid` condition, with the exit through fixing cards in `set_module`; `enforce_rule` and the gated landing name the same condition for an already standing map.
- The built-in `modules` check judges imports by this map, including literal dynamic import and every literal `import.meta.glob` file with `!` exclusions: a relative pattern resolves from its own file, a `/`-rooted pattern from the deepest declared `roots` holding the file. Adding and removing matching files re-judges the unchanged importer. A load whose target is known only at startup — non-literal `import()` and `require()`, globs with other options, a `/`-rooted pattern in a file without a declared root — is no module relation: it is named `unjudged` and doesn't refuse; the `unresolved` policy judges only a literal import landing on nothing. The rule page shows the module's neighbours.
- A test-code-only relation (`imports-tests`) doesn't close the map's cycle: a lower module may be tested through an upper one. For a test file missing a relation, the check recommends a test-code relation, not a production-code relation.

**Limits.** Card text and kind are edited with `update_block`. An import that became resolvable to a later-appearing path isn't re-read until the rule's full measurement ([[4799e983]]).
