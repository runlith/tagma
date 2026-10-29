---
id: 01a0db82-5dfe-7a37-a820-b2318183e6ef
title: "No module re-exports another module's bindings: import from the file that defines them"
ord: 4
tags: ["rule"]
fields:
  {
    "delivery": "code",
    "enforcement": {
      "debt": [],
      "escaped": [],
      "inspection": "reexports",
      "on": [
        {
          "op": "submit_work",
          "phase": "before"
        },
        {
          "op": "merge_worktree",
          "phase": "before"
        }
      ],
      "strictness": "gate"
    }
  }
sources:
  - kind: dir
    ref: .
---
Export * from, export * as ns from, export { … } from, including type-only, and exporting an imported binding are refused. The exports map points at the defining surface files, with no barrel index.ts. Exceptions — a compound component's namespace barrel for import * as X and <X.Root>: the app compound component's **/ui/<component>/index.ts and packages/primitives/src/dialog/index.ts.
