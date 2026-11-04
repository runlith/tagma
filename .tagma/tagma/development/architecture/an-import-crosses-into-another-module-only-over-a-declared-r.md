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
          "changed": "check",
          "commit": "154b89210f2f934573f5fbf8dfc9f3a9fc70d1c1",
          "fingerprint": "@runlith/execution-host -> posix-holder private @ packages/execution-host/src/macosReadings.itest.ts",
          "fix": "Import through an entry `posix-holder` opens to `@runlith/execution-host` (`packages/execution-host/src/posix/testing/`, `packages/execution-host/src/posix/credentials.ts`, `packages/execution-host/src/posix/endpoint.ts`), or open one covering `packages/execution-host/src/posix/macos/processes.ts` with `set_module`.",
          "line": 6,
          "path": "packages/execution-host/src/macosReadings.itest.ts",
          "said": "imports `./posix/macos/processes` of module `posix-holder`, which no entry of `posix-holder` opens to `@runlith/execution-host`"
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
