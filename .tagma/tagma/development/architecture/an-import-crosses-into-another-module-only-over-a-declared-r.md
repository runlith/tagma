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
          "commit": "5606d2d3eb98a830b56a41f3fedba7af08b4fb2b",
          "fingerprint": "host-composition -> posix-holder private @ packages/execution-host/src/Credentials.itest.ts",
          "fix": "Import through an entry `posix-holder` opens to `host-composition` (`packages/execution-host/src/posix/`, `packages/execution-host/src/posix/testing/`), or open one covering `packages/execution-host/src/posix/credentials.ts` with `set_module`.",
          "line": 1,
          "path": "packages/execution-host/src/Credentials.itest.ts",
          "said": "imports `./posix/credentials` of module `posix-holder`, which no entry of `posix-holder` opens to `host-composition`"
        },
        {
          "commit": "5606d2d3eb98a830b56a41f3fedba7af08b4fb2b",
          "fingerprint": "host-composition -> posix-holder private @ packages/execution-host/src/HostConnections.itest.ts",
          "fix": "Import through an entry `posix-holder` opens to `host-composition` (`packages/execution-host/src/posix/`, `packages/execution-host/src/posix/testing/`), or open one covering `packages/execution-host/src/posix/credentials.ts` with `set_module`.",
          "line": 3,
          "path": "packages/execution-host/src/HostConnections.itest.ts",
          "said": "imports `./posix/credentials` of module `posix-holder`, which no entry of `posix-holder` opens to `host-composition`"
        },
        {
          "commit": "5606d2d3eb98a830b56a41f3fedba7af08b4fb2b",
          "fingerprint": "host-composition -> posix-holder private @ packages/execution-host/src/composition/host.ts",
          "fix": "Import it only from test code, or import through an entry `posix-holder` opens to `host-composition` (`packages/execution-host/src/posix/`), or open one covering `packages/execution-host/src/posix/credentials.ts` with `set_module`.",
          "line": 4,
          "path": "packages/execution-host/src/composition/host.ts",
          "said": "imports `../posix/credentials`, a testing entry of `posix-holder`, from code that is no test"
        },
        {
          "commit": "5606d2d3eb98a830b56a41f3fedba7af08b4fb2b",
          "fingerprint": "host-composition -> posix-holder private @ packages/execution-host/src/composition/macos.ts",
          "fix": "Import it only from test code, or import through an entry `posix-holder` opens to `host-composition` (`packages/execution-host/src/posix/`), or open one covering `packages/execution-host/src/posix/endpoint.ts` with `set_module`.",
          "line": 17,
          "path": "packages/execution-host/src/composition/macos.ts",
          "said": "imports `../posix/endpoint`, a testing entry of `posix-holder`, from code that is no test"
        },
        {
          "commit": "5606d2d3eb98a830b56a41f3fedba7af08b4fb2b",
          "fingerprint": "host-composition -> posix-holder private @ packages/execution-host/src/composition/testing/lateCapacity.itest.ts",
          "fix": "Import through an entry `posix-holder` opens to `host-composition` (`packages/execution-host/src/posix/`, `packages/execution-host/src/posix/testing/`), or open one covering `packages/execution-host/src/posix/credentials.ts` with `set_module`.",
          "line": 31,
          "path": "packages/execution-host/src/composition/testing/lateCapacity.itest.ts",
          "said": "imports `../../posix/credentials` of module `posix-holder`, which no entry of `posix-holder` opens to `host-composition`"
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
