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
          "commit": "4e6e4e6ea3a88655e77bc10ae7f0077a507a19f9",
          "fingerprint": "external-harnesses -> @runlith/tagma @ apps/tagma/server/src/external-harnesses/programs/run.ts",
          "fix": "Where `external-harnesses` truly depends on `@runlith/tagma`, add the relation `external-harnesses → @runlith/tagma` with `set_module`; otherwise move this code to the module that owns its meaning, or reach it through a port `external-harnesses` declares and composition fills.",
          "line": 4,
          "path": "apps/tagma/server/src/external-harnesses/programs/run.ts",
          "said": "imports `@runlith/tagma/adapter/provider` of module `@runlith/tagma`, which `external-harnesses` has no relation to"
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
