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
          "commit": "29fc3a93ee77afacd033aef6f190bfc40b71373d",
          "fingerprint": "cut -> @runlith/codesign @ apps/tagma/server/src/cut/dmg.ts",
          "fix": "Where `cut` truly depends on `@runlith/codesign`, add the relation `cut → @runlith/codesign` with `set_module`; otherwise move this code to the module that owns its meaning, or reach it through a port `cut` declares and composition fills.",
          "line": 5,
          "path": "apps/tagma/server/src/cut/dmg.ts",
          "said": "imports `@runlith/codesign/codesign` of module `@runlith/codesign`, which `cut` has no relation to"
        },
        {
          "commit": "29fc3a93ee77afacd033aef6f190bfc40b71373d",
          "fingerprint": "cut -> @runlith/codesign @ apps/tagma/server/src/cut/notarize.ts",
          "fix": "Where `cut` truly depends on `@runlith/codesign`, add the relation `cut → @runlith/codesign` with `set_module`; otherwise move this code to the module that owns its meaning, or reach it through a port `cut` declares and composition fills.",
          "line": 4,
          "path": "apps/tagma/server/src/cut/notarize.ts",
          "said": "imports `@runlith/codesign/codesign` of module `@runlith/codesign`, which `cut` has no relation to"
        },
        {
          "commit": "29fc3a93ee77afacd033aef6f190bfc40b71373d",
          "fingerprint": "cut -> mac-applications @ apps/tagma/server/src/cut/pipeline.ts",
          "fix": "Where `cut` truly depends on `mac-applications`, add the relation `cut → mac-applications` with `set_module`; otherwise move this code to the module that owns its meaning, or reach it through a port `cut` declares and composition fills.",
          "line": 19,
          "path": "apps/tagma/server/src/cut/pipeline.ts",
          "said": "imports `../mac-applications/bundle.js` of module `mac-applications`, which `cut` has no relation to"
        },
        {
          "commit": "29fc3a93ee77afacd033aef6f190bfc40b71373d",
          "fingerprint": "cut -> mac-applications @ apps/tagma/server/src/cut/release.ts",
          "fix": "Where `cut` truly depends on `mac-applications`, add the relation `cut → mac-applications` with `set_module`; otherwise move this code to the module that owns its meaning, or reach it through a port `cut` declares and composition fills.",
          "line": 15,
          "path": "apps/tagma/server/src/cut/release.ts",
          "said": "imports `../mac-applications/bundle.js` of module `mac-applications`, which `cut` has no relation to"
        },
        {
          "commit": "29fc3a93ee77afacd033aef6f190bfc40b71373d",
          "fingerprint": "cut -> @runlith/codesign @ apps/tagma/server/src/cut/sealing.ts",
          "fix": "Where `cut` truly depends on `@runlith/codesign`, add the relation `cut → @runlith/codesign` with `set_module`; otherwise move this code to the module that owns its meaning, or reach it through a port `cut` declares and composition fills.",
          "line": 4,
          "path": "apps/tagma/server/src/cut/sealing.ts",
          "said": "imports `@runlith/codesign/codesign` of module `@runlith/codesign`, which `cut` has no relation to"
        },
        {
          "commit": "29fc3a93ee77afacd033aef6f190bfc40b71373d",
          "fingerprint": "cut -> mac-applications @ apps/tagma/server/src/cut/transition.ts",
          "fix": "Where `cut` truly depends on `mac-applications`, add the relation `cut → mac-applications` with `set_module`; otherwise move this code to the module that owns its meaning, or reach it through a port `cut` declares and composition fills.",
          "line": 17,
          "path": "apps/tagma/server/src/cut/transition.ts",
          "said": "imports `../mac-applications/bundle.js` of module `mac-applications`, which `cut` has no relation to"
        },
        {
          "commit": "29fc3a93ee77afacd033aef6f190bfc40b71373d",
          "fingerprint": "cut -> mac-applications @ apps/tagma/server/src/cut/world.ts",
          "fix": "Where `cut` truly depends on `mac-applications`, add the relation `cut → mac-applications` with `set_module`; otherwise move this code to the module that owns its meaning, or reach it through a port `cut` declares and composition fills.",
          "line": 19,
          "path": "apps/tagma/server/src/cut/world.ts",
          "said": "imports `../mac-applications/bundle.js` of module `mac-applications`, which `cut` has no relation to"
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
