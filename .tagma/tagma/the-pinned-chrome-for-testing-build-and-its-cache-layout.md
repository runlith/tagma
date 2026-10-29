---
id: 01a1835e-fcdd-7b33-bb06-eb8bb3df9a16
title: The pinned Chrome for Testing build and its cache layout
ord: 1214
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "src/build.ts"
      }
    ],
    "id": "@runlith/chrome-for-testing"
  }
sources:
  - kind: dir
    ref: packages/chrome-for-testing
---
The managed browser and real-engine tests use the same Chrome distribution, so its release identity and cached executable path have one owner; downloading and launching remain with their callers.