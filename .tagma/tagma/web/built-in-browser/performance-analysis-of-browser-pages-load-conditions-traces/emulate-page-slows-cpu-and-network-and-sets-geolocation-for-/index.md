---
id: 01a184dc-4fbe-7b01-a2d5-4fad152e6f61
title: emulate_page slows CPU and network and sets geolocation for the run that asked
ord: 1
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a184dc-4fbe-7b01-a2d5-4fa84aecb62a
---
**Outcome.** `emulate_page` takes three more conditions beside viewport, device and color scheme:
- `cpu` — a slowdown factor from 1 to 20; 1 removes it.
- `network` — a preset (`offline`, `slow-3g`, `fast-3g`, `slow-4g`, `fast-4g`, with DevTools' numbers, kept in one table beside `DEVICES`) or explicit latency and download and upload throughput; `null` removes it.
- `geolocation` — latitude, longitude and an optional accuracy; `null` removes it.
The answer carries the page's effective emulation; every later answer about the page names active conditions.

**How.**
- CPU: `Emulation.setCPUThrottlingRate` on the page session and on every attached out-of-process frame's child session, including frames attached later while the rate stands. Chromium's throttler is per renderer process, so pages of the profile sharing that renderer slow too; the tool grammar says so.
- Network: `Network.emulateNetworkConditionsByRule` with one rule matching every request. `navigator.connection` is left alone; `offline` also sets `Network.overrideNetworkState` so `navigator.onLine` and the `offline` event match. The performer measures whether that override stays within the page on both hosts; if it reaches other pages, the grammar names that limit.
- Geolocation: `Emulation.setGeolocationOverride`, and the page's geolocation permission granted for as long as the override stands through a `PageHost` action. Desktop main allows `geolocation` for that `webContents` in the partition's permission handlers, which deny it otherwise; the managed host calls `Browser.setPermission` for the page's origin in the profile's context and restores the previous setting when the override ends. The managed grant reaches other pages of the same origin in that profile; the grammar names it.
- Strain: while a CPU rate stands, the engine holds the port's strain hold at that factor. Desktop watchdogs aggregate holds by exact OS renderer process, including the page's native frame renderers; managed watchdogs and the engine's OOP-frame probes aggregate by profile because their CDP target IDs expose no renderer identity. Desktop CPU strain temporarily uses profile scope only while a strained page navigates toward an unknown speculative renderer, returning to exact membership on commit or failure; heap pause stays on its captured PID. A same-renderer sibling therefore is not mistaken for a hung page. This conservative managed scope delays detection of a genuinely hung other page of that profile until strain ends; engine frame probes with unknown renderer identity pay the same cost.
- Lifetime follows the parent's shared rule: the conditions end with the setting thread's run, and the engine removes them explicitly then rather than waiting for a detach.
- The client panel marks a page under conditions and offers one act that removes them.

**Owners.** `browser` engine (`engine/emulate.ts`, the emulation wire and the page state), `PageHost` for the geolocation grant and the strain hold, the desktop and managed adapters filling them, the panel for the mark.

**Acceptance.**
- The public emulation operation sends the requested CPU rate to root and child sessions and holds matching strain until clearing. Fixed-work loop timings on the page and a cross-origin frame are reported as one sample with the machine named; wall-time ratios are not pass/fail assertions on a shared machine.
- Under `slow-3g` a test-server response arrives no sooner than the preset's latency; under `offline` a fetch fails and `navigator.onLine` is false.
- `navigator.geolocation.getCurrentPosition` yields the emulated coordinates; after removal the desktop host denies the permission again.
- A page running a 400 ms main-thread task every second at `cpu: 20` is never refused as `page-unresponsive`, and the managed host never swaps its target.
- After the setting thread's run ends, page conditions return to their unthrottled state through the same public operations; the cleared rate and strain are checked as facts, with loop timings retained only as sample evidence.
