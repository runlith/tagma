---
id: 01a17e98-1419-7671-acef-ed56164b7987
title: "Tsconfig checks do not read the git submodule: extends through a package leading to a submodule drops modules with 'the tree lacks'"
ord: 44
tags: ["reflection"]
fields:
  {
    "actual": "inspection failed after 1.2 s: `tagma/packages/tsconfig/bun.json` 'which the tree lacks', with a suggestion to commit a copy and declare it in `built`",
    "command": "check_rules {over: \"all\", inspection: \"modules\", project: \"runlith-private\"}",
    "expected": "extends `@runlith/tsconfig/bun.json`, whose package is a link into the `tagma/` submodule, reads from the checkout as an installed package, and the inspection measures boundaries"
  }
---
A submodule in the git tree is one gitlink record (`160000 commit`) with no files. The `node_modules/@runlith/tsconfig` link leads to `tagma/packages/tsconfig`, a path inside the checkout but outside the tree and outside `node_modules`. Code facts counted only `node_modules` and paths outside the checkout as environment, so such a path fell into the `built` contract — a generated file. Any project that includes a shared config or package as a git submodule is affected: both via a `node_modules` link and via a direct path `extends`.
