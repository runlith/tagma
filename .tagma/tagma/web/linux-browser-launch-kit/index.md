---
id: 01a1a83d-f5bb-7757-9552-28547a5fba4d
title: Linux browser launch · kit
ord: 34
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "platform.ts",
        "for": [
          "3d10c144"
        ]
      }
    ],
    "id": "chromium-launch-linux",
    "kind": "kit"
  }
edges:
  - kind: imports
    to: 01a1a83d-f5b5-71c2-b345-4b5f6df10877
sources:
  - kind: dir
    ref: packages/chrome-for-testing/src/launch/linux
---
Linux browser owners need a usable sandbox and, for a windowed process, a desktop display. The adapter validates an explicitly configured helper, discovers installed root-owned helpers and translates native startup diagnostics; it changes no machine policy and leaves process ownership to callers.