---
id: 01a0daef-c524-7436-be73-12bd925aed1c
title: Core code-facts and its `./languages` door don't load the parser at runtime
ord: 8
tags: ["rule"]
fields:
  {
    "enforcement": {
      "debt": [],
      "escaped": [],
      "inspection": "loads-925aed1c",
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
    ref: packages/code-facts
---
`languages/index.ts` is the door the browser loads; `oxc-parser` stays behind `./adapters` and `./js`. A lazy `import()` counts as a load. A new top-level `src` file is added to `from` through `enforce_rule` in the same change that adds it.
