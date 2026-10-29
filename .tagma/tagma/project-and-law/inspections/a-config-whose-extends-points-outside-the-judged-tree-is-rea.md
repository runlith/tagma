---
id: 01a13fce-1448-71e1-a8a2-453ca71f4364
title: A config whose extends points outside the judged tree is read through the `built` copy, and without it the judgment refuses naming the file
ord: 30
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a13f95-60fe-7047-a344-e33f81074aa9
sources:
  - kind: file
    ref: apps/tagma/inspection/src/packs/architecture/modules/probes.ts
  - kind: file
    ref: packages/code-facts/src/languages/js/config.ts
  - kind: symbol
    ref: apps/tagma/server/src/enforcement/workers/sides.ts
    symbol: sideTree
---
The judged tree is the commit's git objects. A file the build generates and git ignores (`.svelte-kit/tsconfig.json`, `.nuxt/tsconfig.json`) is not there, yet its `paths` decide where an alias lands.

- The verdict depends only on the tree and the rule's declarations. Rejected: taking the file from the working directory; running the generator over the commit tree (the answer would depend on the machine and the installed `node_modules`, [[a6a73286|setup-step idea]]); reading the config without the file (aliases would silently become false unresolveds).
- The declaration is the `modules` rule's `built` entry: output — the generated file's path, source — the committed copy. The config host in code-facts serves the copy's text at the output's place, so a verbatim copy of the generated file works with its relative paths.
- A stale copy never judges silently. Where the judging checkout holds the generated file itself, code-facts compares it against the copy as a config, ignoring formatting. When they disagree, `CopyStale` is thrown with both paths, and the server answers `inspection-failed`. The verdict still never depends on the working directory: the file from it is only verified against the copy and never read instead of it. Only the judged side is compared — HEAD at measurement, the commit tree at landing; the base side is not compared, so a commit that aligns the copy lands. Where there is no generated file (CI, fresh clone), there is nothing to verify against. Verification goes against the file as the checkout holds it (generation freshness is not checked), a merge verifies against its worktree's file, the inspections CLI against the file of the repository it measures. The whole parsed config is compared without ordinary object-key order; array order and the `compilerOptions.paths` key order are preserved because alias patterns with the same prefix can compete. A divergence that does not move the verdict still refuses. Platforms verifies the declared copies before consulting package contribution memo, so a stale copy is one failed inspection rather than one unresolved crossing per start.
- The copy is named `.json`: code-facts treats an input as a config only by that name, and editing a copy under another name would never re-resolve importers, so such an entry refuses when read.
- Output and source are recorded in the importers' resolution inputs, and the rule's `relevant` accepts their paths outside the region too: editing the copy re-resolves files resolved through it.
- With no entry or a missing copy, code-facts throws `InputAbsent` with the config and the missing path (for `extends` without `.json` — the path with `.json`, as TypeScript seeks it), modules appends which entry resolves it, the server answers `inspection-failed`. A path inside `node_modules`, inside a `.gitmodules` submodule, or outside the checkout, by package name or by path, is not a generated file but environment: the judgment reads it from the package installed in the judged checkout ([[edd30011]]).
- The copy lands in a separate earlier commit than the entry: enforce_rule measures the entry on HEAD, and the commit's base side reads its base's configs.
