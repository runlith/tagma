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
          "commit": "49d4a7e414c3c0ff621242cc011b93cd4fc39cb2",
          "fingerprint": "@tagma/desktop -> @runlith/desktop-host private @ apps/tagma/desktop/src/projectWindows.ts",
          "fix": "Import through an entry `@runlith/desktop-host` opens to `@tagma/desktop` (`packages/desktop-host/src/ExternalLinks.ts`, `packages/desktop-host/src/WindowPlacement.ts`, `packages/desktop-host/src/GlobalShortcuts.ts`), or open one covering `packages/desktop-host/src/QuickHideShortcut.ts` with `set_module`.",
          "line": 2,
          "path": "apps/tagma/desktop/src/projectWindows.ts",
          "said": "imports `@runlith/desktop-host/QuickHideShortcut` of module `@runlith/desktop-host`, which no entry of `@runlith/desktop-host` opens to `@tagma/desktop`"
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
