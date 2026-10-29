---
id: 01a0caaf-0b3c-7042-a03e-c4d346cccc36
title: Show `..`-led inside names relative in displayPath
ord: 27
tags: ["task"]
fields:
  {
    "status": "closed"
  }
---
In `packages/agent-tools/src/display.ts`, `displayPath` keeps any path whose relative form starts with `..` absolute — so an inside name like `..cache` is never shortened. Replace the prefix test with an exact `..`-segment test (`..` itself or `..` plus the separator); then revisit [[21eddb28]].