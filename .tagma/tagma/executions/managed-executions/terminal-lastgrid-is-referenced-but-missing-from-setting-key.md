---
id: 01a0cae4-944d-7387-9e7c-25eccd47f9a5
title: "`terminal.lastGrid` is referenced but missing from `SETTING_KEYS`, so its write refuses and its read falls back"
ord: 57
tags: ["task"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: symbol
    ref: apps/tagma/server/src/executions/contract/wire/terminalBehavior.ts
    symbol: terminalLastGrid
---
`terminal.lastGrid` is declared as a key (the grid a harness pane last settled at, for birthing the next CLI at the shown size) and referenced on both ends — the write in `HarnessTerminal.svelte:42`, the launch read in `harnessLaunch.ts:43` — but missing from `SETTING_KEYS`, so `Settings.write` refuses it as `unknown-setting`: the app's write is caught and dropped, the launch read always answers the fallback null, and the birth-grid optimization never lands.

Done when the key is registered so its write lands and its read answers — or the declaration and both references go.