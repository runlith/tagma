---
id: 01a0eed5-adb6-7d6f-971c-a67a083d37f1
title: An import crosses into another module only over a declared relation and through an entry open to the importer
ord: 10
tags: ["rule"]
fields:
  {
    "delivery": "code",
    "enforcement": {
      "debt": [],
      "escaped": [
        {
          "commit": "cd997bf31414d343bfeab49f309a73866dae3490",
          "fingerprint": "composition -> views private @ apps/tagma/server/src/composition/http/sites.ts",
          "fix": "Import through an entry `views` opens to `composition` (`apps/tagma/server/src/views/contract/`, `apps/tagma/server/src/views/views.ts`), or open one covering `apps/tagma/server/src/views/files.ts` with `set_module`.",
          "line": 11,
          "path": "apps/tagma/server/src/composition/http/sites.ts",
          "said": "imports `../../views/files.js` of module `views`, which no entry of `views` opens to `composition`"
        }
      ],
      "inspection": "modules",
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
A module's boundaries — its root, entries, relations and `order` — stand on its #module card, and `set_module` changes them. Inside a module, imports run only down the card's `order`. Only test code enters another module's `testing` entry; production relations stand in an acyclic order, and a test-only relation (`imports-tests`) does not close a cycle; every file of the region belongs to a module.
