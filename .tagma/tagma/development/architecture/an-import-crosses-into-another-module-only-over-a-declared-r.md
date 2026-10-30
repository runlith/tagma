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
          "commit": "6447176519f2fceb9c993842d28e429ea59d1886",
          "fingerprint": "external-harnesses -> @runlith/adapter-cursor @ apps/tagma/server/src/external-harnesses/runner/cursor/channel.ts",
          "fix": "Import `@runlith/adapter-cursor` only from test code, or open the relation `external-harnesses → @runlith/adapter-cursor` to all code with `set_module`.",
          "line": 5,
          "path": "apps/tagma/server/src/external-harnesses/runner/cursor/channel.ts",
          "said": "imports `@runlith/adapter-cursor/selection` of module `@runlith/adapter-cursor`, which `external-harnesses` may import from test code only"
        },
        {
          "commit": "6447176519f2fceb9c993842d28e429ea59d1886",
          "fingerprint": "external-harnesses -> @runlith/adapter-cursor @ apps/tagma/server/src/external-harnesses/runner/cursor/cycle.ts",
          "fix": "Import `@runlith/adapter-cursor` only from test code, or open the relation `external-harnesses → @runlith/adapter-cursor` to all code with `set_module`.",
          "line": 8,
          "path": "apps/tagma/server/src/external-harnesses/runner/cursor/cycle.ts",
          "said": "imports `@runlith/adapter-cursor/selection` of module `@runlith/adapter-cursor`, which `external-harnesses` may import from test code only"
        },
        {
          "commit": "6447176519f2fceb9c993842d28e429ea59d1886",
          "fingerprint": "external-harnesses -> @runlith/adapter-cursor @ apps/tagma/server/src/external-harnesses/runner/cursor/run.ts",
          "fix": "Import `@runlith/adapter-cursor` only from test code, or open the relation `external-harnesses → @runlith/adapter-cursor` to all code with `set_module`.",
          "line": 6,
          "path": "apps/tagma/server/src/external-harnesses/runner/cursor/run.ts",
          "said": "imports `@runlith/adapter-cursor/selection` of module `@runlith/adapter-cursor`, which `external-harnesses` may import from test code only"
        },
        {
          "commit": "6447176519f2fceb9c993842d28e429ea59d1886",
          "fingerprint": "external-harnesses -> @runlith/adapter-cursor @ apps/tagma/server/src/external-harnesses/runner/cursor/sdk.ts",
          "fix": "Import `@runlith/adapter-cursor` only from test code, or open the relation `external-harnesses → @runlith/adapter-cursor` to all code with `set_module`.",
          "line": 7,
          "path": "apps/tagma/server/src/external-harnesses/runner/cursor/sdk.ts",
          "said": "imports `@runlith/adapter-cursor/selection` of module `@runlith/adapter-cursor`, which `external-harnesses` may import from test code only"
        },
        {
          "commit": "6447176519f2fceb9c993842d28e429ea59d1886",
          "fingerprint": "external-harnesses -> @runlith/adapter-opencode @ apps/tagma/server/src/external-harnesses/runner/opencode/run.ts",
          "fix": "Import `@runlith/adapter-opencode` only from test code, or open the relation `external-harnesses → @runlith/adapter-opencode` to all code with `set_module`.",
          "line": 4,
          "path": "apps/tagma/server/src/external-harnesses/runner/opencode/run.ts",
          "said": "imports `@runlith/adapter-opencode/host` of module `@runlith/adapter-opencode`, which `external-harnesses` may import from test code only"
        },
        {
          "commit": "6447176519f2fceb9c993842d28e429ea59d1886",
          "fingerprint": "external-harnesses -> @runlith/adapter-opencode @ apps/tagma/server/src/external-harnesses/runner/opencode/sdk.ts",
          "fix": "Import `@runlith/adapter-opencode` only from test code, or open the relation `external-harnesses → @runlith/adapter-opencode` to all code with `set_module`.",
          "line": 5,
          "path": "apps/tagma/server/src/external-harnesses/runner/opencode/sdk.ts",
          "said": "imports `@runlith/adapter-opencode/host` of module `@runlith/adapter-opencode`, which `external-harnesses` may import from test code only"
        },
        {
          "commit": "6447176519f2fceb9c993842d28e429ea59d1886",
          "fingerprint": "external-harnesses -> @runlith/adapter-openai @ apps/tagma/server/src/external-harnesses/vendors/codex/row.ts",
          "fix": "Import `@runlith/adapter-openai` only from test code, or open the relation `external-harnesses → @runlith/adapter-openai` to all code with `set_module`.",
          "line": 24,
          "path": "apps/tagma/server/src/external-harnesses/vendors/codex/row.ts",
          "said": "imports `@runlith/adapter-openai/models/openai` of module `@runlith/adapter-openai`, which `external-harnesses` may import from test code only"
        },
        {
          "commit": "6447176519f2fceb9c993842d28e429ea59d1886",
          "fingerprint": "external-harnesses -> @runlith/adapter-cursor @ apps/tagma/server/src/external-harnesses/vendors/cursor/row.ts",
          "fix": "Import `@runlith/adapter-cursor` only from test code, or open the relation `external-harnesses → @runlith/adapter-cursor` to all code with `set_module`.",
          "line": 21,
          "path": "apps/tagma/server/src/external-harnesses/vendors/cursor/row.ts",
          "said": "imports `@runlith/adapter-cursor/icon` of module `@runlith/adapter-cursor`, which `external-harnesses` may import from test code only"
        },
        {
          "commit": "6447176519f2fceb9c993842d28e429ea59d1886",
          "fingerprint": "external-harnesses -> @runlith/adapter-opencode @ apps/tagma/server/src/external-harnesses/vendors/opencode/row.ts",
          "fix": "Import `@runlith/adapter-opencode` only from test code, or open the relation `external-harnesses → @runlith/adapter-opencode` to all code with `set_module`.",
          "line": 1,
          "path": "apps/tagma/server/src/external-harnesses/vendors/opencode/row.ts",
          "said": "imports `@runlith/adapter-opencode/host` of module `@runlith/adapter-opencode`, which `external-harnesses` may import from test code only"
        },
        {
          "commit": "6447176519f2fceb9c993842d28e429ea59d1886",
          "fingerprint": "external-harnesses -> @runlith/adapter-devin @ apps/tagma/server/src/external-harnesses/vendors/devin/row.ts",
          "fix": "Import `@runlith/adapter-devin` only from test code, or open the relation `external-harnesses → @runlith/adapter-devin` to all code with `set_module`.",
          "line": 4,
          "path": "apps/tagma/server/src/external-harnesses/vendors/devin/row.ts",
          "said": "imports `@runlith/adapter-devin/models/devin` of module `@runlith/adapter-devin`, which `external-harnesses` may import from test code only"
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
