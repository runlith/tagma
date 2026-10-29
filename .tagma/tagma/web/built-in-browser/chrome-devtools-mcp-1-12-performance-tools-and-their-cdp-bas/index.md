---
id: 01a184dc-4fbe-7b01-a2d5-4fa6af5babaa
title: chrome-devtools-mcp 1.12 performance tools and their CDP basis on Electron 44.8 and pipe-driven Chromium (read 2026-10-29)
ord: 17
tags: ["research"]
fields:
  {
    "source": {
      "name": "chrome-devtools-mcp",
      "ref": ".external/chrome-devtools-mcp at 63170b11a2fa74d5ceea757194d7b25f3e145f68 (1.12.0, 2026-10-28); also devtools-frontend, devtools-protocol, Chromium and Electron main, read 2026-10-29"
    }
  }
---
How chrome-devtools-mcp 1.12.0 does performance traces, throttling and geolocation, Lighthouse, heap snapshots and screen recording; what each costs; what a page can see; and whether the CDP it needs exists on Electron 44.8 `webContents.debugger` and on Chromium driven over `--remote-debugging-pipe`. One child per capability holds the details.

**What was read (2026-10-29).**
- chrome-devtools-mcp at `63170b11a2fa74d5ceea757194d7b25f3e145f68` (1.12.0, committed 2026-10-28), clone `.external/chrome-devtools-mcp`: `src/tools/{performance,emulation,lighthouse,memory,screencast}.ts`, `src/processors/*`, `src/McpPage.ts` (emulation), `src/third_party/index.ts`, `src/devtools/DevtoolsUtils.ts`, `scripts/prepare.ts`, `rollup.config.js`, the bundled `lighthouse-devtools-mcp-bundle.js`. The `third_party/devtools-frontend` submodule is empty in this clone; its `mcp/mcp.ts`, `models/trace/types/TraceEvents.ts` and the two AI formatters were read from GitHub `main` the same day.
- CDP definitions: `ChromeDevTools/devtools-protocol` master `pdl` for Page, Tracing, IO, Network, Emulation, Browser and `js_protocol.pdl` (HeapProfiler).
- Chromium `main` (googlesource): `content/browser/devtools/render_frame_devtools_agent_host.cc`, `protocol/tracing_handler.cc`, `protocol/page_handler.cc`, `content/public/browser/devtools_agent_host_client.cc`, `third_party/blink/renderer/core/inspector/inspector_emulation_agent.cc`.
- Electron `main`: `shell/browser/api/electron_api_debugger.{h,cc}`, `electron_api_web_contents.cc` (`TakeHeapSnapshot`), `docs/api/web-contents.md`, `docs/api/content-tracing.md`.
- npm registry metadata on 2026-10-29: chrome-devtools-mcp 1.12.0, lighthouse 13.6.0, `@paulirish/trace_engine` 0.0.67 (tarball unpacked and listed), axe-core 4.14.0; Puppeteer's `page.record()` docs, PR #15387 and issue #15591 (secondary sources).

**What the evidence does not establish.** Nothing was run: no browser, no Electron, no chrome-devtools-mcp test. Chromium and Electron were read at `main`, not at Electron 44.8's Chromium 152.0.7977.167 or Chrome for Testing 151: a statement about those versions is inference from `main` unless a child says otherwise. No size or time below was measured here except file and package sizes.

**Cross-cutting observations.**
- chrome-devtools-mcp drives Chrome through puppeteer-core; each capability is a puppeteer helper. Beside it, every page gets a second CDP session running DevTools frontend models inside Node (`createTargetUniverse`). To keep that frontend from undoing puppeteer's throttling and blocking, `overrideDevToolsGlobals` replaces the frontend's `Network.emulateNetworkConditionsByRule`, `overrideNetworkState`, `enable`, `disable`, `setBlockedURLs` and `Audits.enable` with no-ops: two sessions on one page fight over network emulation.
- The performance, Lighthouse, heap and recording tools are declared `concurrency: 'exclusive'`; one trace may run at a time across the whole server.
- Electron's `Debugger` does not override `DevToolsAgentHostClient::IsTrusted`, whose default is `true` (`AllowUnsafeOperations` defaults to `false`). Chromium gives trusted clients the full Tracing handler (see the traces child). Inference for 44.8: the same, since the override is absent on `main`.

**Per capability, in short** (details and sources in the children):
- Traces: CDP `Tracing` + `IO`, the DevTools trace engine and DevTools' AI text formatters; both hosts expose Tracing on a main-frame session.
- Throttling and geolocation: `Emulation.setCPUThrottlingRate` (renderer-process-wide), `Network.emulateNetworkConditionsByRule`, `Emulation.setGeolocationOverride` plus a permission the page target cannot grant itself.
- Lighthouse: a 3.75 MB bundle bound to a puppeteer `Page`; enables `Runtime` and `Debugger` and, in navigation mode, clears the origin's service workers and caches and the browser HTTP cache.
- Heap snapshots: `HeapProfiler.takeHeapSnapshot` chunk events; Electron also has a native `webContents.takeHeapSnapshot(path)` whose bytes never pass main's JS; analysis is DevTools' heap snapshot worker.
- Recording: puppeteer `page.record()` = `Page.startScreenRecording`, absent before Chromium 153 and mutually exclusive with `Page.startScreencast` on one session.
