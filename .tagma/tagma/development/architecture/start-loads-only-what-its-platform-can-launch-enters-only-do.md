---
id: 01a0eed5-adbb-7f6e-9425-985750520d64
title: Start loads only what its platform can launch, enters only doors declared for that platform, and loads nothing its package rejects
ord: 11
tags: ["rule"]
fields:
  {
    "delivery": "code",
    "enforcement": {
      "debt": [
        {
          "fingerprint": "apps/tagma/server/src/native-harness/transcript/rested.worker.ts [bun] -> unresolved source @ apps/tagma/server/src/native-harness/transcript/rested.worker.ts",
          "owner": "e5e5c094"
        }
      ],
      "escaped": [],
      "inspection": "platforms",
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
A door's platforms are its manifest's export conditions. Each declared door is a start on every platform it declares, and so every app file, route module and worker. Third-party and built-in refusals are this rule's parameters; a workspace package's refusal is the `modules` relation.
