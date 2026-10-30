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
          "commit": "d6be3c96a1409139de71fedb364ac512e4a34695",
          "fingerprint": "external-harnesses -> @runlith/adapter-opencode @ apps/tagma/server/src/external-harnesses/runner/opencode/run.ts",
          "fix": "Import `@runlith/adapter-opencode` only from test code, or open the relation `external-harnesses → @runlith/adapter-opencode` to all code with `set_module`.",
          "line": 4,
          "path": "apps/tagma/server/src/external-harnesses/runner/opencode/run.ts",
          "said": "imports `@runlith/adapter-opencode/host` of module `@runlith/adapter-opencode`, which `external-harnesses` may import from test code only"
        },
        {
          "commit": "d6be3c96a1409139de71fedb364ac512e4a34695",
          "fingerprint": "external-harnesses -> @runlith/adapter-opencode @ apps/tagma/server/src/external-harnesses/runner/opencode/sdk.ts",
          "fix": "Import `@runlith/adapter-opencode` only from test code, or open the relation `external-harnesses → @runlith/adapter-opencode` to all code with `set_module`.",
          "line": 5,
          "path": "apps/tagma/server/src/external-harnesses/runner/opencode/sdk.ts",
          "said": "imports `@runlith/adapter-opencode/host` of module `@runlith/adapter-opencode`, which `external-harnesses` may import from test code only"
        },
        {
          "commit": "d6be3c96a1409139de71fedb364ac512e4a34695",
          "fingerprint": "external-harnesses -> @runlith/adapter-opencode @ apps/tagma/server/src/external-harnesses/vendors/opencode/row.ts",
          "fix": "Import `@runlith/adapter-opencode` only from test code, or open the relation `external-harnesses → @runlith/adapter-opencode` to all code with `set_module`.",
          "line": 1,
          "path": "apps/tagma/server/src/external-harnesses/vendors/opencode/row.ts",
          "said": "imports `@runlith/adapter-opencode/host` of module `@runlith/adapter-opencode`, which `external-harnesses` may import from test code only"
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
