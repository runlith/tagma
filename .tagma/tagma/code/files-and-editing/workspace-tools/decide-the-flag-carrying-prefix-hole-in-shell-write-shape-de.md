---
id: 01a0ca9a-6233-7f23-90e6-075ba6b98340
title: Decide the flag-carrying prefix hole in shell write-shape detection
ord: 24
tags: ["task"]
fields:
  {
    "status": "closed"
  }
---
In `packages/agent-tools/src/shellShapes.ts`, `withoutPrefixes` strips `command`/`builtin`/`exec` as one word and `env` with following assignments only — so `env -i echo hi > p` and `command -p echo hi > p` stop stripping at the flag, judge no write shape, and run the identical single-file write past the owning tool (losing its alias checks, permits and prose law). Either extend the stripping past flags that provably preserve the verb's file effect, or record the hole as accepted; naive flag-skipping is wrong in the other direction (`command -v foo` runs nothing). Then revisit [[7fb19c55]].