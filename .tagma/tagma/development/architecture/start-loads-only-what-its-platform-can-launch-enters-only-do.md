---
id: 01a0eed5-adbb-7f6e-9425-985750520d64
title: Start loads only what its platform can launch, enters only doors declared for that platform, and loads nothing its package rejects
ord: 11
tags: ["rule"]
fields:
  {
    "delivery": "code",
    "enforcement": {
      "debt": [],
      "escaped": [
        {
          "commit": "d3b63780f6a2a3115c248662977003ee288ce730",
          "fingerprint": "@tagma/app/theme [browser] -> unresolved ./theme @ apps/tagma/app/package.json",
          "fix": "Point the `exports` entry `./theme` of `apps/tagma/app/package.json` at a file the tree holds, or name `@tagma/app` in `compiled` where its build emits it.",
          "holder": "01a1b110-e4ac-7664-8239-25b90aaf5ade",
          "line": 1,
          "path": "apps/tagma/app/package.json",
          "said": "The declared door resolves to no file"
        }
      ],
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
