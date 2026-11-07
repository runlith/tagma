---
id: 01a12f83-9c8e-769f-8f0a-1f18e0801f50
title: Adapter author kit
ord: 34
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "rules.ts",
        "for": [
          "7abcb9a1"
        ]
      }
    ],
    "id": "@runlith/tagma-kit"
  }
edges:
  - kind: imports
    to: 01a0c702-bcab-7b1f-9440-825f382fa6aa
  - kind: imports
    to: 01a0d584-d0b8-7967-9796-a8e3bbddbda9
  - kind: imports
    to: 01a12c51-8120-7250-9703-61feea5c74f4
sources:
  - kind: dir
    ref: packages/tagma/kit
---
Assembling the package's distribution lives here: it bakes the workspace's host-module list into the published SDK as literal imports (replacing `src/adapter/sdkHost.ts`), so a built SDK serves its own copies of the host modules to a plugin's providers module at build and in conformance. The distribution carries: `/rules` types expanded from the builtins' schemas, the adapter and plugin doors with their declarations and the `tagma-plugin` bin, and the plugin SDK's point types, its build check bundled from the owners' own code, and external operation types, generated from the server into committed files.