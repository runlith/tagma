---
id: 01a184dc-4fbe-7b01-a2d5-4fa7017d7c9e
title: "Performance traces with insights: Tracing over an IO stream, the DevTools trace engine and its AI formatters"
ord: 1
tags: ["research"]
fields:
  {
    "source": {
      "name": "chrome-devtools-mcp performance tools; DevTools trace engine",
      "ref": "chrome-devtools-mcp 63170b11a2fa74d5ceea757194d7b25f3e145f68 src/tools/performance.ts, src/processors/; devtools-frontend main mcp/mcp.ts; @paulirish/trace_engine 0.0.67; devtools-protocol master Tracing.pdl, IO.pdl; Chromium main tracing_handler.cc, render_frame_devtools_agent_host.cc"
    }
  }
---
**chrome-devtools-mcp, observed** (`src/tools/performance.ts`, `src/processors/`):
- `performance_start_trace {reload=true, autoStop=true, ignoreCache?, filePath?}`. With `reload` it first goes to `about:blank` (waiting `load`), starts tracing, then navigates back to the original URL and waits `load`; `ignoreCache` turns the HTTP cache off for that navigation. With `autoStop` it sleeps a fixed 5 s and stops; otherwise `performance_stop_trace` stops later.
- Categories: `-*`, DevTools' `DefaultCategories` (`blink.console`, `blink.user_timing`, `loading`, `devtools.timeline`, `disabled-by-default-devtools.timeline{,.frame,.stack}`, `…target-rundown`, `…v8-source-rundown{,-sources}`, `disabled-by-default-layout_shift.debug`, `disabled-by-default-v8.inspector`, `disabled-by-default-v8.cpu_profiler.hires`, `disabled-by-default-lighthouse`, `v8.execute`, `v8`, `cppgc`, `navigation,rail`), plus the optional `disabled-by-default-v8.cpu_profiler` (JS sampling) and `disabled-by-default-devtools.screenshot`. puppeteer's `tracing.start` gets `bufferSize: 1200 * 1000`.
- Stop: puppeteer returns the whole trace as one in-memory buffer; an optional file copy is gzipped with zlib. `ChunkedTraceParser` scans the bytes and `JSON.parse`s events in batches (10,000 events or 32 MB) to stay under V8's string limit. A fresh `TraceModel.Model.createWithAllHandlers()` parses each trace, because a model retains every trace it parsed. The page's CPU rate and network preset go in as trace metadata so insights know the conditions.
- Output: DevTools' `PerformanceTraceFormatter.formatTraceSummary` over `AgentFocus.fromParsedTrace` gives the summary with insight-set ids; `performance_analyze_insight {insightSetId, insightName}` formats one insight (e.g. `DocumentLatency`, `LCPBreakdown`) with `PerformanceInsightFormatter`, always from the most recent trace only. Parsed traces are kept in memory in the server context.
- CrUX field data is on by default (`--no-performance-crux` turns it off): the trace's insight URLs and main-frame URL are sent to `chromeuxreport.googleapis.com` with a public API key, and field metrics join the summary.

**The dependency.**
- chrome-devtools-mcp vendors devtools-frontend as a sparse submodule (`front_end/` without `panels/` and `ui/`, plus `mcp/`), compiles and bundles it, and installs stubs for the frontend's globals (`InspectorFrontendHost`, locale, formatter worker). `mcp/mcp.ts` re-exports SDK core, `TraceEngine`, `CrUXManager`, `HeapSnapshotModel`, the AI formatters and more. The formatters import SDK core (`core/sdk`, CrUX manager, AI call tree and queries): they do not come without the frontend core. The published chrome-devtools-mcp package is 14.3 MB unpacked, of which the Lighthouse bundle is 3.75 MB.
- `@paulirish/trace_engine` 0.0.67, published from devtools-frontend and used by Lighthouse 13 (0.0.65 in chrome-devtools-mcp's lockfile): 17 MB unpacked, of which JavaScript is 1.26 MB (locales 9.1 MB, sample traces 2.3 MB, the rest types and maps). It holds `models/trace` (handlers and 24 insight modules), `cpu_profile` and `crux-manager`, not the AI formatters. Its `analyze-trace.mjs` runs in Node: polyfill `DOMRect`, `Model.createWithAllHandlers().parse(events)`, read `parsedTrace.insights`.

**CDP** (`Tracing.pdl`, `IO.pdl`):
- `Tracing.start` takes `transferMode: ReturnAsStream`, `streamFormat: json|proto`, `streamCompression: none|gzip`, `traceConfig {includedCategories, enableSampling, traceBufferSizeInKb (default 200 MB), recordMode}`, `screenshotMaxSize` (default 500 px) and `screenshotMaxCount` (default 450) clamped to a per-session budget. `Tracing.end` → `tracingComplete {stream, dataLossOccurred}`; `IO.read {handle, size}` returns chunks (`base64Encoded` for gzip); `IO.close`. The alternative `ReportEvents` delivers `dataCollected` events with parsed event arrays.
- Chromium: `RenderFrameDevToolsAgentHost` creates the `TracingHandler` only for main-frame sessions. For an untrusted client the handler filters data sources and drops the browser process from the process filter; for a trusted client it adds the browser and GPU process ids.
- Electron 44.8 `webContents.debugger`: a trusted client attached to the page's main frame (inference from `main`), so `Tracing.start` should be accepted there, and a trace would include the Electron browser process — on the Tagma desktop, its main process — and the GPU process. Every `IO.read` answer crosses Electron main, where the browser-desktop measurement put CDP answers at about 0.1 s per MB ([[255c4582|desktop host]]); applying it to `IO.read` is inference.
- Electron's `contentTracing` records the whole application, not a page, and writes Perfetto protobuf, which the JSON trace engine does not read.
- Over `--remote-debugging-pipe` every domain is available.

**Cost and detection (inference, nothing measured).** A page's JS sees no domain enabled by tracing; it can only notice the overhead of JS sampling (hires sampling is in the default set) and screenshots. Trace size grows with run length, JS activity and screenshots; parsing it is seconds of CPU on a large trace — the reason chrome-devtools-mcp parses in batches.
