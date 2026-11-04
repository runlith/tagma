---
id: 01a1a83d-f5b5-71c2-b345-4b5f6df10877
title: Browser launch prerequisites · kit
ord: 33
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "platform.ts"
      }
    ],
    "id": "chromium-launch",
    "kind": "kit"
  }
sources:
  - kind: dir
    ref: packages/chrome-for-testing/src/launch/contract
---
Browser owners need the same typed preparation and startup refusal without knowing a machine's display or sandbox. The contract carries a prepared process environment and an actionable failure; process creation, profiles and browser policy remain with callers.