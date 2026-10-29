---
id: 01a16e73-b8a5-75fc-b26a-9c66f46f78a5
title: The inventory-change wait arms at call time, not when the waiting fiber starts
ord: 11
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a16e6e-69ed-71ba-9c40-72eecffc50bb
sources:
  - kind: file
    ref: packages/execution-host/src/subscriptions.ts
  - kind: symbol
    ref: packages/execution-host/src/registry/launch.ts
    symbol: Executions
---
`inventoryChanged()` takes the current wake-up `Deferred` at once and returns an await of exactly it, after the `changed(execution)` pattern. The caller arms the await first, then checks state (`settingUp`, `summary`, the page, `sealed`), and only then waits. A change between check and await already completed the taken `Deferred`, so nothing is lost.

The old shape read the `Deferred` inside the await. A waiter deferred through `forkChild` took the next `Deferred` already if inventory managed to shift before its start. The state subscription could then hang until an unrelated change, and the inventory subscription deliver late. IPC latency to the SQLite child hid this race; in-process SQLite hosting surfaced it.
