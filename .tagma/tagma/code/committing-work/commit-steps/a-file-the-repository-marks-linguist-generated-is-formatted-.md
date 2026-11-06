---
id: 01a1ae37-ffe9-7559-9c79-d75207e69d56
title: A file the repository marks linguist-generated is formatted, judged and swept by no commit step, and measured by no rule
ord: 9
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/platform/git/generated.ts
  - kind: file
    ref: apps/tagma/server/src/commit-steps/selection.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/judging/trees.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/sweep/stripComments.ts
  - kind: file
    ref: apps/tagma/server/src/platform/git/generatedAttribute.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/programs/layout.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/programs/runner.ts
  - kind: symbol
    ref: apps/tagma/server/src/enforcement/workers/treeMemo.ts
    symbol: generatedAt
  - kind: symbol
    ref: apps/tagma/server/src/enforcement/programs/bindings.ts
    symbol: judgeBindings
---
A file a build writes and the repository commits — a plugin's `dist/process.js` and `tagma-plugin.json`, a generated client — is the build's to change, never a commit step's: a formatter rewriting a bundle changes what runs, and a rule judging one refuses every landing of a rebuild over code nobody wrote by hand. The repository says which files those are with the standard git attribute, so no list of paths lives in Tagma and any project's generated files are covered: the plugin template writes `dist/** linguist-generated=true` and `tagma-plugin.json linguist-generated=true` into the plugin's `.gitattributes`.

- **Format commands** skip such a path beside a path with a `filter` attribute, read in the private commit tree from one `check-attr` call.
- **Rules** judge no such path, so a plugin's `dist/` never becomes debt. A change is judged without them, at a landing and in `check_rules` over a change. A measurement — `enforce_rule`, `check_rules` over `all`, a remeasure, `set_module` — leaves them out of the files it judges at each place those are chosen: a builtin's reach in the inspection worker, memoized per tree; a program's whole listing in its runner; a linter's laid-out reach; the paths handed to a measured program. The file stays in the tree, so an import of it still resolves. `platforms`, judged in slices from its entries, is not filtered. The attribute is read from the judged tree (`check-attr --source`, git 2.40 and later, the floor `merge-tree --merge-base` already sets), so an uncommitted `.gitattributes` edit in a shared checkout never changes what another session's landing is judged on.
- **The comment sweep** (`strip_comments`) skips them, reading the working tree's attributes, since it rewrites working files.

Only `set` and `true` count; `linguist-generated=false` marks nothing.
