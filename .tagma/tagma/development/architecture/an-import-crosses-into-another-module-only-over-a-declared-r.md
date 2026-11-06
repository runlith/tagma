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
          "commit": "faa89ddb916591576f4fcbd7b1cd48ffa3d00dae",
          "fingerprint": "views -> mcp @ apps/tagma/server/src/views/contract/service/views.ts",
          "fix": "Where `views` truly depends on `mcp`, add the relation `views → mcp` with `set_module`; otherwise move this code to the module that owns its meaning, or reach it through a port `views` declares and composition fills.",
          "line": 5,
          "path": "apps/tagma/server/src/views/contract/service/views.ts",
          "said": "imports `../../../mcp/contract/wire/feeds.js` of module `mcp`, which `views` has no relation to"
        },
        {
          "commit": "faa89ddb916591576f4fcbd7b1cd48ffa3d00dae",
          "fingerprint": "views -> mcp @ apps/tagma/server/src/views/contract/wire/feeds.ts",
          "fix": "Where `views` truly depends on `mcp`, add the relation `views → mcp` with `set_module`; otherwise move this code to the module that owns its meaning, or reach it through a port `views` declares and composition fills.",
          "line": 2,
          "path": "apps/tagma/server/src/views/contract/wire/feeds.ts",
          "said": "imports `../../../mcp/contract/wire/feeds.js` of module `mcp`, which `views` has no relation to"
        },
        {
          "commit": "faa89ddb916591576f4fcbd7b1cd48ffa3d00dae",
          "fingerprint": "views -> mcp @ apps/tagma/server/src/views/shelf.ts",
          "fix": "Where `views` truly depends on `mcp`, add the relation `views → mcp` with `set_module`; otherwise move this code to the module that owns its meaning, or reach it through a port `views` declares and composition fills.",
          "line": 5,
          "path": "apps/tagma/server/src/views/shelf.ts",
          "said": "imports `../mcp/contract/wire/feeds.js` of module `mcp`, which `views` has no relation to"
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
