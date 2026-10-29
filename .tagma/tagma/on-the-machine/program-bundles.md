---
id: 01a1165d-b047-7099-969a-602c520698f4
title: Program bundles
ord: 35
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "src/bundle.ts"
      },
      {
        "at": "src/maps.ts"
      }
    ],
    "id": "@runlith/bundle"
  }
edges:
  - kind: imports
    to: 01a0c703-263a-7a49-8a3d-0bfdc70821a1
  - kind: imports-tests
    to: 01a13b4d-7a3d-7729-955f-a344b43ff1ba
sources:
  - kind: dir
    ref: packages/bundle
---
A Tagma delivery and the execution-host bundle assemble programs into a directory, and a program runs workers and child processes next to itself by `new URL('./name', import.meta.url)`. The package assembles the entry and finds each such file in the built bundle, then assembles it too, recursively, and refuses if the source is missing or two different files claim one name. So the set of what ships derives from the code itself, not from a list someone can forget to extend. What to do with assembled texts — write, check, hand out roles — is the caller's call.
