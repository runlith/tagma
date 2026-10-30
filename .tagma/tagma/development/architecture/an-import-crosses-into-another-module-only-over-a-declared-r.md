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
          "commit": "f3fca1d2d007df34d5e8444b919fc2c7a76eaafb",
          "fingerprint": "external-harnesses -> @runlith/adapter-opencode private @ apps/tagma/server/src/external-harnesses/testing/opencodePlugin.itest.ts",
          "fix": "Import through an entry `@runlith/adapter-opencode` opens to `external-harnesses` (`packages/adapter-opencode/src/adapter.ts`, `packages/adapter-opencode/src/harness/opencode.ts`, `packages/adapter-opencode/src/harness/session.ts`, `packages/adapter-opencode/src/runner/run.ts`), or open one covering `packages/adapter-opencode/src/environment.ts` with `set_module`.",
          "line": 6,
          "path": "apps/tagma/server/src/external-harnesses/testing/opencodePlugin.itest.ts",
          "said": "imports `@runlith/adapter-opencode/environment` of module `@runlith/adapter-opencode`, which no entry of `@runlith/adapter-opencode` opens to `external-harnesses`"
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
