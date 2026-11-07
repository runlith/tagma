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
          "commit": "061b20c3e2492ec7f040cff186cdc13aef61cd65",
          "fingerprint": "@runlith/tagma-kit -> @runlith/llm @ packages/tagma/kit/conformance.ts",
          "fix": "Where `@runlith/tagma-kit` truly depends on `@runlith/llm`, add the relation `@runlith/tagma-kit → @runlith/llm` with `set_module`; otherwise move this code to the module that owns its meaning, or reach it through a port `@runlith/tagma-kit` declares and composition fills.",
          "line": 4,
          "path": "packages/tagma/kit/conformance.ts",
          "said": "imports `@runlith/llm/route/client` of module `@runlith/llm`, which `@runlith/tagma-kit` has no relation to"
        },
        {
          "commit": "061b20c3e2492ec7f040cff186cdc13aef61cd65",
          "fingerprint": "@runlith/tagma-kit -> @runlith/adapter-anthropic @ packages/tagma/kit/host.generated.ts",
          "fix": "Where `@runlith/tagma-kit` truly depends on `@runlith/adapter-anthropic`, add the relation `@runlith/tagma-kit → @runlith/adapter-anthropic` with `set_module`; otherwise move this code to the module that owns its meaning, or reach it through a port `@runlith/tagma-kit` declares and composition fills.",
          "line": 2,
          "path": "packages/tagma/kit/host.generated.ts",
          "said": "imports `@runlith/adapter-anthropic/icon` of module `@runlith/adapter-anthropic`, which `@runlith/tagma-kit` has no relation to"
        },
        {
          "commit": "061b20c3e2492ec7f040cff186cdc13aef61cd65",
          "fingerprint": "@runlith/tagma-kit -> @runlith/adapter-deepseek @ packages/tagma/kit/host.generated.ts",
          "fix": "Where `@runlith/tagma-kit` truly depends on `@runlith/adapter-deepseek`, add the relation `@runlith/tagma-kit → @runlith/adapter-deepseek` with `set_module`; otherwise move this code to the module that owns its meaning, or reach it through a port `@runlith/tagma-kit` declares and composition fills.",
          "line": 5,
          "path": "packages/tagma/kit/host.generated.ts",
          "said": "imports `@runlith/adapter-deepseek/models/deepseek` of module `@runlith/adapter-deepseek`, which `@runlith/tagma-kit` has no relation to"
        },
        {
          "commit": "061b20c3e2492ec7f040cff186cdc13aef61cd65",
          "fingerprint": "@runlith/tagma-kit -> @runlith/adapter-devin @ packages/tagma/kit/host.generated.ts",
          "fix": "Where `@runlith/tagma-kit` truly depends on `@runlith/adapter-devin`, add the relation `@runlith/tagma-kit → @runlith/adapter-devin` with `set_module`; otherwise move this code to the module that owns its meaning, or reach it through a port `@runlith/tagma-kit` declares and composition fills.",
          "line": 7,
          "path": "packages/tagma/kit/host.generated.ts",
          "said": "imports `@runlith/adapter-devin/icon` of module `@runlith/adapter-devin`, which `@runlith/tagma-kit` has no relation to"
        },
        {
          "commit": "061b20c3e2492ec7f040cff186cdc13aef61cd65",
          "fingerprint": "@runlith/tagma-kit -> @runlith/adapter-google @ packages/tagma/kit/host.generated.ts",
          "fix": "Where `@runlith/tagma-kit` truly depends on `@runlith/adapter-google`, add the relation `@runlith/tagma-kit → @runlith/adapter-google` with `set_module`; otherwise move this code to the module that owns its meaning, or reach it through a port `@runlith/tagma-kit` declares and composition fills.",
          "line": 9,
          "path": "packages/tagma/kit/host.generated.ts",
          "said": "imports `@runlith/adapter-google/icon` of module `@runlith/adapter-google`, which `@runlith/tagma-kit` has no relation to"
        },
        {
          "commit": "061b20c3e2492ec7f040cff186cdc13aef61cd65",
          "fingerprint": "@runlith/tagma-kit -> @runlith/adapter-muse @ packages/tagma/kit/host.generated.ts",
          "fix": "Where `@runlith/tagma-kit` truly depends on `@runlith/adapter-muse`, add the relation `@runlith/tagma-kit → @runlith/adapter-muse` with `set_module`; otherwise move this code to the module that owns its meaning, or reach it through a port `@runlith/tagma-kit` declares and composition fills.",
          "line": 10,
          "path": "packages/tagma/kit/host.generated.ts",
          "said": "imports `@runlith/adapter-muse/icon` of module `@runlith/adapter-muse`, which `@runlith/tagma-kit` has no relation to"
        },
        {
          "commit": "061b20c3e2492ec7f040cff186cdc13aef61cd65",
          "fingerprint": "@runlith/tagma-kit -> @runlith/adapter-openai @ packages/tagma/kit/host.generated.ts",
          "fix": "Where `@runlith/tagma-kit` truly depends on `@runlith/adapter-openai`, add the relation `@runlith/tagma-kit → @runlith/adapter-openai` with `set_module`; otherwise move this code to the module that owns its meaning, or reach it through a port `@runlith/tagma-kit` declares and composition fills.",
          "line": 14,
          "path": "packages/tagma/kit/host.generated.ts",
          "said": "imports `@runlith/adapter-openai/models/openai` of module `@runlith/adapter-openai`, which `@runlith/tagma-kit` has no relation to"
        },
        {
          "commit": "061b20c3e2492ec7f040cff186cdc13aef61cd65",
          "fingerprint": "@runlith/tagma-kit -> @runlith/adapter-opencode-go @ packages/tagma/kit/host.generated.ts",
          "fix": "Where `@runlith/tagma-kit` truly depends on `@runlith/adapter-opencode-go`, add the relation `@runlith/tagma-kit → @runlith/adapter-opencode-go` with `set_module`; otherwise move this code to the module that owns its meaning, or reach it through a port `@runlith/tagma-kit` declares and composition fills.",
          "line": 16,
          "path": "packages/tagma/kit/host.generated.ts",
          "said": "imports `@runlith/adapter-opencode-go/models/opencodeGo` of module `@runlith/adapter-opencode-go`, which `@runlith/tagma-kit` has no relation to"
        },
        {
          "commit": "061b20c3e2492ec7f040cff186cdc13aef61cd65",
          "fingerprint": "@runlith/tagma-kit -> @runlith/adapter-stepfun @ packages/tagma/kit/host.generated.ts",
          "fix": "Where `@runlith/tagma-kit` truly depends on `@runlith/adapter-stepfun`, add the relation `@runlith/tagma-kit → @runlith/adapter-stepfun` with `set_module`; otherwise move this code to the module that owns its meaning, or reach it through a port `@runlith/tagma-kit` declares and composition fills.",
          "line": 18,
          "path": "packages/tagma/kit/host.generated.ts",
          "said": "imports `@runlith/adapter-stepfun/models/stepfun` of module `@runlith/adapter-stepfun`, which `@runlith/tagma-kit` has no relation to"
        },
        {
          "commit": "061b20c3e2492ec7f040cff186cdc13aef61cd65",
          "fingerprint": "@runlith/tagma-kit -> @runlith/adapter-xai @ packages/tagma/kit/host.generated.ts",
          "fix": "Where `@runlith/tagma-kit` truly depends on `@runlith/adapter-xai`, add the relation `@runlith/tagma-kit → @runlith/adapter-xai` with `set_module`; otherwise move this code to the module that owns its meaning, or reach it through a port `@runlith/tagma-kit` declares and composition fills.",
          "line": 20,
          "path": "packages/tagma/kit/host.generated.ts",
          "said": "imports `@runlith/adapter-xai/icon` of module `@runlith/adapter-xai`, which `@runlith/tagma-kit` has no relation to"
        },
        {
          "commit": "061b20c3e2492ec7f040cff186cdc13aef61cd65",
          "fingerprint": "@runlith/tagma-kit -> @runlith/held @ packages/tagma/kit/host.generated.ts",
          "fix": "Where `@runlith/tagma-kit` truly depends on `@runlith/held`, add the relation `@runlith/tagma-kit → @runlith/held` with `set_module`; otherwise move this code to the module that owns its meaning, or reach it through a port `@runlith/tagma-kit` declares and composition fills.",
          "line": 23,
          "path": "packages/tagma/kit/host.generated.ts",
          "said": "imports `@runlith/held/Held` of module `@runlith/held`, which `@runlith/tagma-kit` has no relation to"
        },
        {
          "commit": "061b20c3e2492ec7f040cff186cdc13aef61cd65",
          "fingerprint": "@runlith/tagma-kit -> @runlith/llm @ packages/tagma/kit/host.generated.ts",
          "fix": "Where `@runlith/tagma-kit` truly depends on `@runlith/llm`, add the relation `@runlith/tagma-kit → @runlith/llm` with `set_module`; otherwise move this code to the module that owns its meaning, or reach it through a port `@runlith/tagma-kit` declares and composition fills.",
          "line": 24,
          "path": "packages/tagma/kit/host.generated.ts",
          "said": "imports `@runlith/llm/models/authStatus` of module `@runlith/llm`, which `@runlith/tagma-kit` has no relation to"
        },
        {
          "commit": "061b20c3e2492ec7f040cff186cdc13aef61cd65",
          "fingerprint": "composition -> @runlith/tagma-kit private @ apps/tagma/server/src/composition/testing/adapterProbe.ts",
          "fix": "Open an entry of `@runlith/tagma-kit` covering `packages/tagma/kit/conformance.ts` to `composition` with `set_module`, or move the code to the module that owns its meaning.",
          "line": 3,
          "path": "apps/tagma/server/src/composition/testing/adapterProbe.ts",
          "said": "imports `@runlith/tagma/adapter/conformance` of module `@runlith/tagma-kit`, which no entry of `@runlith/tagma-kit` opens to `composition`"
        },
        {
          "commit": "061b20c3e2492ec7f040cff186cdc13aef61cd65",
          "fingerprint": "composition -> @runlith/tagma-kit private @ apps/tagma/server/src/composition/testing/externalAdapters.itest.ts",
          "fix": "Open an entry of `@runlith/tagma-kit` covering `packages/tagma/kit/create.ts` to `composition` with `set_module`, or move the code to the module that owns its meaning.",
          "line": 5,
          "path": "apps/tagma/server/src/composition/testing/externalAdapters.itest.ts",
          "said": "imports `@runlith/tagma/adapter/create` of module `@runlith/tagma-kit`, which no entry of `@runlith/tagma-kit` opens to `composition`"
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
