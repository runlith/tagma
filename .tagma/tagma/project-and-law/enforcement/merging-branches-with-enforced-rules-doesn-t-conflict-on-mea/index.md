---
id: 01a10c35-d246-7a89-b8b9-b324b58a937f
title: Merging branches with enforced rules doesn't conflict on measurement observations, and an open graph merge is named directly
ord: 15
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/enforcement/remeasure/rule.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/rules/enforce.ts
  - kind: file
    ref: apps/tagma/server/src/graph/contract/wire/enforcement.ts
  - kind: file
    ref: apps/tagma/server/src/graph/tree/layout.ts
---
Merging two branches that each measured an enforced rule at least once always gives a git conflict in that rule's file in `.tagma`. Until the conflict resolves, the server can't read the graph and answers with an unclear YAML error. Goal: merging branches with enforced rules doesn't conflict where there is no meaning conflict, and a real unfinished graph merge is named directly.

## What was observed

Merging `main` into the `effect-4.0.1` worktree (October 5, 2026) conflicted in four rule files: `tagma-650-import.md`, `floors-model-client-runtime.md`, `import-relation-entry-importer.md`, `core-code-facts-door-languages-parser-runtime.md`.
- **What diverged:** only `enforcement.baseline.commit` and `enforcement.measured.{at,ms}`. Each side wrote its own SHA and time.
- **Where records come from:** `set_module` and `enforce_rule` remeasure rules and always write both fields (`rules/enforce.ts`, `ledger`).
- **One more write after the merge commit:** the remeasure driver (`remeasure/rule.ts`) recorded a new `baseline.commit` and lowered debt `value` (View.svelte.ts 1225 → 1205). Because of it `merge_worktree` refused with `uncommitted`.
- **Error during the conflict:** while `<<<<<<<` markers stood, any graph-reading call refused with `graph-pool` / `BlockTreeUnreadable … frontmatter-yaml: YAML Parse error: Unexpected token`. It didn't say the graph has an open merge and how to finish it.

## Cause

`baseline` and `measured` are observations of one checkout: on which of its commits and in how many milliseconds the rule was measured on this machine. They lie in the shared rule document travelling in `.tagma` with the branch. Two branches inevitably write different things there, although the rule law (strictness, triggers, inspection, debt) didn't change. `documentRevision` already ignores these fields ([[be584b76]] §16 expects two branches to meet in a graph merge only when both changed the document).

## What is needed

1. **Measurement observations leave the shared document.** `baseline.commit` and `measured.{ms,at}` are stored outside tracked graph files, by checkout (root) and rule. `enforce_rule`, `set_module` and remeasure write them; rule-debt lineage (`renamedBetween`), the engine digest (`engines.ts`), `engineReading` and the Engine screen in the app, `read_inspections` read them.
   - The `lawEnforcementSchema` no longer has these fields. Stored documents are migrated by a graph step (`graph/tree/steps/`), and reading code only knows the new shape.
   - A checkout with no own observation (fresh worktree or clone) works. Lineage takes the point the debt was actually recorded from: e.g. the commit where the rule document last changed, when the graph lies in the tree. The implementer records the choice and its reason in a #note on that code.
2. **Debt lowering converges with no conflict.** When both sides only lowered a debt record's `value` or `count` or removed it, the merge result is the minimum and removal, with no manual resolution. The way (a graph merge driver Tagma registers for `.tagma`, or another) is the implementer's pick.
3. **An open merge in the graph is named directly.** A graph file with conflict markers refuses with a dedicated code: it names the file, says the merge isn't finished, and gives `unblock` (resolve the conflict and finish the merge). It no longer looks like a YAML parse error.

## Acceptance

- Two branches from one point, each with its own `set_module` or `enforce_rule` under the same law, merge with `git merge` and `merge_worktree` with no `.tagma` conflicts.
- After a merge through Tagma, remeasure leaves no uncommitted graph files in the worktree, and a repeated `merge_worktree` doesn't refuse `uncommitted` on the server's own records.
- Branches that lowered one debt record differently merge to the minimum. Branches that changed the rule law (strictness, inspection, debt owner) conflict as before.
- The Engine screen and `read_inspections` show the measurement time and commit for this checkout.
- Rename lineage of a file with debt works in a checkout with no own observation.
- A graph with a conflict marker refuses with a new code naming the file; no YAML error.
