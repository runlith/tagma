---
id: 01a184dc-4fbe-7b01-a2d5-4faa4b4a0d78
title: "Heap snapshots: HeapProfiler chunk events, Electron's native takeHeapSnapshot and DevTools' snapshot worker"
ord: 4
tags: ["research"]
fields:
  {
    "source": {
      "name": "chrome-devtools-mcp memory tools; Electron webContents",
      "ref": "chrome-devtools-mcp 63170b11a2fa74d5ceea757194d7b25f3e145f68 src/tools/memory.ts, src/processors/HeapSnapshotManager.ts; devtools-protocol master js_protocol.pdl; Electron main electron_api_web_contents.cc, docs/api/web-contents.md"
    }
  }
---
**chrome-devtools-mcp, observed** (`src/tools/memory.ts`, `src/processors/HeapSnapshotManager.ts`):
- `take_heapsnapshot {filePath}` calls puppeteer `page.captureHeapSnapshot({path})` and answers with the path.
- Behind `--memoryDebugging`, thirteen browserless tools read `.heapsnapshot` files: summary (statistics, native context sizes, retained-by-context), class aggregates (paged), instances of a class, retainers, retaining paths, dominator chain, outgoing edges, object details, object query by class, property, type, sizes and detachment, duplicate strings, closure contexts holding dead captured fields, and a comparison of two snapshots by class and by object; `close_heapsnapshot` frees one.
- Mechanism: DevTools' `HeapSnapshotWorkerProxy` runs DevTools' `heap_snapshot_worker` entry in a worker; the file streams in 1 MB UTF-8 chunks into its loader; the loaded snapshot stays cached per absolute path until closed; reads queue per file. This model is part of the vendored devtools-frontend, not of `@paulirish/trace_engine`.

**CDP** (`js_protocol.pdl`): `HeapProfiler.takeHeapSnapshot {reportProgress, captureNumericValue, exposeInternals}`; the snapshot arrives as `HeapProfiler.addHeapSnapshotChunk {chunk}` string events, with `reportHeapSnapshotProgress {done, total, finished}`.

**Electron 44.8.0, source reading.** [`WebContents::TakeHeapSnapshot`](https://github.com/electron/electron/blob/v44.8.0/shell/browser/api/electron_api_web_contents.cc) opens the output and passes its handle over Mojo; [`ElectronApiServiceImpl::TakeHeapSnapshot`](https://github.com/electron/electron/blob/v44.8.0/shell/renderer/electron_api_service_impl.cc) writes through the renderer's isolate. [`heap_snapshot.cc`](https://github.com/electron/electron/blob/v44.8.0/shell/common/heap_snapshot.cc) calls V8's heap profiler directly, serializes to that handle and deletes the snapshot. None of this path checks or detaches the debugger. [`ElectronSandboxedRendererClient::RenderFrameCreated`](https://github.com/electron/electron/blob/v44.8.0/shell/renderer/electron_sandboxed_renderer_client.cc) invokes the base which installs this Mojo service in sandboxed frames too. The [API docs](https://github.com/electron/electron/blob/v44.8.0/docs/api/web-contents.md#contentstakeheapsnapshotfilepath) declare a file-writing promise without a debugger or sandbox restriction. This establishes a native route independent of CDP by code; success with Tagma's attached debugger in a sandboxed renderer remains unproved by a run. It captures the main frame's V8 isolate, so same-isolate pages can appear and other-process frames are outside it. Through `webContents.debugger` instead, every chunk event crosses main, where CDP traffic cost about 0.1 s per MB in the browser-desktop measurement ([[255c4582|desktop host]]); applying it to chunk events is inference.

**Cost, detection, content (inference).** Taking a snapshot runs a full garbage collection and stops the renderer's main thread until the snapshot is written — seconds on a large heap; files run from tens to hundreds of megabytes. A page sees no domain, but sees the pause through timing and the collection through `FinalizationRegistry` callbacks. The file holds every string in the page's heap, sign-in tokens and form contents included.

**On both hosts.** Over the pipe the CDP route has no main process in the way; on desktop the native call avoids it.
