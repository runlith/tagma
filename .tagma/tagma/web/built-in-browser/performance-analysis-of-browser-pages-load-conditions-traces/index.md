---
id: 01a184dc-4fbe-7b01-a2d5-4fac647a38eb
title: "Performance analysis of browser pages: load conditions, traces with insights, heap snapshots and recording, in that order"
ord: 18
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a184dc-4fbe-7b01-a2d5-4fa6af5babaa
  - kind: relates
    to: 01a184dc-4fbe-7b01-a2d5-4fa9ddb8b6fa
---
**What the user gets.** An agent building a web application finds and proves performance problems in the built-in browser the way a developer does in DevTools: it slows the CPU and network and sets a location to reproduce a user's conditions, records a trace of a page load or an interaction and reads Core Web Vitals and DevTools' insights as text, captures a heap snapshot to chase a leak, and records the page to a video the operator can watch. It works on any page the engine drives, on the desktop and the managed host, through tools an app calls the same way. A human sharing the page sees in the panel that it is slowed, traced or recorded. Projects with no web code never meet it beyond the browser tools they already have. The reading behind every choice is [[af5babaa|the research]].

**Order.** Each step ships and is useful alone:
1. [[152e6f61|Load conditions]] in `emulate_page` — the smallest step, and what makes a trace mean anything: an insight measured on a developer's M-series laptop without throttling says little about a user's phone.
2. [[5c99a890|Traces with insights]] — the largest gap against chrome-devtools-mcp and the most valuable for an agent fixing a slow page.
3. [[c9b1db59|Heap snapshots]] with a class summary and growth against the previous capture.
4. [[ae28c378|Recording]] to MP4.

**Owners and boundaries.**
- The `browser` engine owns every piece: the per-page state (conditions, a running trace, a running recording), the CDP it sends over its one session per page, refusals and answers. Operations are declared in `contract/wire/pageOperations.ts` like the existing page tools: `callers: any`, an outside caller admitted, reads declared `read`, the rest `external`, no approval. The new tools join the browser's tool working set.
- `@runlith/cdp` gains Tagma-unaware primitives only: reading an `IO` stream handle into a file in bounded chunks, with decoding in its payload worker.
- Host ports. `PageHost` gains two things every host fills: writing the page's heap snapshot to a path, and a scoped **strain** hold — the engine tells the host the page's renderer runs slowed by a factor or is paused by the engine's own command, and the host's unresponsive detector scales its threshold by that factor or stays silent while paused. The engine's own frame probes follow the same hold. Without it a 20× CPU rate or a multi-second heap snapshot reads as a hung renderer, and the managed host would replace the target of a page being measured. A geolocation grant for one page is a third `PageHost` action. Adapters: [[4103030b|desktop]] with main in [[2f69b0c4|desktop window]], [[ac637dff|managed Chromium]].
- Heavy parsing runs in workers its owner provides ([[7a910861|event-loop rule]]): trace analysis in a `browser` worker, heap snapshot reading in `@runlith/performance`, which already owns the V8 heap snapshot format for the server's own captures. A server runs one heavy analysis at a time: a large trace or heap snapshot takes hundreds of megabytes while parsed, and two at once can exhaust an 8 GB machine.
- [[8f8c2801|Timeline rendering]] already encodes MP4 with WebCodecs in a browser target and muxes in its worker. Recording reuses it through a port the `browser` module declares and `page-render` fills; composition binds them, so `browser` never imports it.
- The client panel shows a page's active conditions, trace and recording with one act that ends them.

**Shared rules.**
- Conditions, a trace and a recording belong to the thread that started them and end when its run ends, when it ends them, or when the page's engine session ends; a trace or recording ending that way still writes its file — a trace only while the CDP session that recorded it still answers: Chromium drops a trace with that session, so one ended by a lost or taken session answers `trace-failed` saying so. A forgotten 20× CPU rate or a trace filling its buffer must never outlive the agent's measurement on a page a human uses. Unlike viewport, device and color scheme, they are not re-applied when a session reattaches.
- Every answer about a page under conditions names them, so the agent's later deadlines and conclusions account for them.
- Files go where the engine keeps the page's other captures; an answer names the path and size. Heap snapshots keep the newest four per page, as the server's own snapshots do, because each runs to hundreds of megabytes.
- Refusals beside the existing ones: `trace-running`, `no-trace`, `recording-running`, `no-recording`, each naming who started the running one; DevTools held by a human and an open dialog refuse as for any action.

**Deliberately not built.**
- **Lighthouse.** It is 19.4 MB with 22 dependencies, needs a puppeteer `Page` that `webContents.debugger` cannot give, enables `Runtime` and `Debugger`, and in navigation mode deletes the origin's service workers, Cache Storage and the browser HTTP cache of a signed-in profile and accepts every dialog. Its performance category is what trace insights already give — chrome-devtools-mcp itself keeps performance out of its Lighthouse tool. What remains of value, accessibility, is the fifth step: `audit_page`, axe-core alone in the engine's isolated world.
- **CrUX field data.** chrome-devtools-mcp sends traced URLs to Google by default; for an agent's dev server the field data is empty, and sending a user's browsing to a third party is not a performance feature.
- **Vendoring the DevTools frontend** for its AI formatters and heap snapshot worker: it means building a frontend fork and stubbing its globals, and chrome-devtools-mcp already patches its network methods to keep it from fighting puppeteer. The published trace engine plus our own formatter covers traces; class aggregates cover the first heap step.
- **`Page.startScreenRecording` and ffmpeg.** The command is missing before Chromium 153 — Electron 44.8 is 152 — and it cannot run beside the viewers' `Page.startScreencast` on the one session per page; ffmpeg is not on every machine.
- **Electron `contentTracing`**: application-wide and Perfetto protobuf.
- **The deprecated `Network.emulateNetworkConditions`**, which changes network state for every page.

**Decided (operator, 2026-10-29).** The spec is accepted.
- An accessibility audit with axe-core (652 KB) run in the engine's isolated world — Lighthouse's most useful category without `Runtime.enable` or storage resets — is a fifth step, after the four above.
- A recording is a file named in the answer and also a playable video in the thread feed, as motion videos are.
- The heap step stops at the class summary and growth. Deep analysis (retainers, dominators, object-level comparison) waits for a shared V8 snapshot reader that would also serve Tagma's own server snapshots.

**Proof.** Each step names its own. Scenarios join the shared engine scenarios in `browser/testing/scenarios.ts`, so they run on the managed host in engine system tests and on the desktop host under real Electron once [[6febfab1]] runs the shared set there. Measurements are reported as one sample with the machine named.
