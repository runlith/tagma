---
id: 01a1458b-fed6-736e-84e1-c73154c13672
title: "A commit gate wrapped around husky mutes the repo's own pre-commit: husky `h` looks for `.husky/<name>.tagma-chained`"
ord: 45
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1457e-b3df-721a-b633-e86cc903d6a8",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a14583-1237-7b7b-b1c3-31e015608150
sources:
  - kind: file
    ref: apps/tagma/server/src/enforcement/contract/wire/gateHook.ts
---
Gate install moves the old hook to `<hook>.tagma-chained` and calls it as `"$chained" "$@"` (`chaining` in `gateHook.ts`). Husky 9 puts `. "$(dirname "$0")/h"` into `.husky/_/<hook>`, and `h` picks the user script by `basename "$0"`: under the gate that's `pre-commit.tagma-chained`, there is no `.husky/pre-commit.tagma-chained`, and `h` exits 0. Result: in any husky repo under Tagma the lint/format from `.husky/pre-commit` silently never runs — neither for `git commit` nor for landings. Measured: a fixture with a husky layout on its own `tagma:try`, a hook requiring `node_modules/tool.js` didn't refuse without the file; the same layout in `/opt/workspaces/gf-tagma` (`.husky/_/pre-commit.tagma-chained` → `h`).

No simple paths: `. "$chained"` in a subshell would keep `$0` but breaks non-sh chained hooks; a `.tagma-chained/<hook>` directory gives `h` a path to the gate itself — recursion. The fix belongs to the gate owner; proof is a husky layout where a `.husky/pre-commit` refusal refuses a commit under the gate.
