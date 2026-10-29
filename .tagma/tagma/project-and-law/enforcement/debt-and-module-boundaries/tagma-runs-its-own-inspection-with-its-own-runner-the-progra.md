---
id: 01a157a7-2939-76d6-9c61-4b52986c1611
title: "Tagma runs its own inspection with its own runner: the program module loads from the checkout, and `@runlith/tagma/*` arrives as a virtual module"
ord: 6
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/enforcement/programs/checker.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/programs/runner.ts
---
The stdin/stdout protocol (`ProgramInvocation`/`ProgramAnswer`) is held by the server and the runner, the program author never sees it: Bun Tagma starts `runner.ts` with the `defineProgram` module path from the description, cwd at the checkout root. The module imports by checkout paths and takes dependencies from the project `node_modules`, but reads git-stored sources from the judged tree ([[261204b5]]), while the runner serves `@runlith/tagma/rules` and `/rules/effect` as a copy from the Tagma build through a `build.module` runtime plugin. `onResolve` interception is rejected: a prototype showed it doesn't see a bare specifier from a file on disk.

One module's program keys run in one process (the checker groups by module path), and facts gather over the union of all group keys' `needs`. The function is called once per key with both sides: when measuring a whole reach, the paths' sides are plain commit files in the key reach (symlink and gitlink don't count as sources, as in changed paths), otherwise the changed paths; `read` serves the given text or lazily reads the commit blob. An answer with no `tree` read and `findings` is a program failure, not a clean court. A read with no `base` means the program found nothing on base, and each of its tree violations compares against an empty base.

Linters go the same way as before the config: a named tool is its own file adapter, `Linters.command` is the shared `command-sarif` adapter (per-file count by `ruleId`, as SARIF adapters) or `command-findings` (command findings as-is). The command receives both sides' files in a scratch directory under `tree/` and `base/`, exits 0 and 1 count as worked.
