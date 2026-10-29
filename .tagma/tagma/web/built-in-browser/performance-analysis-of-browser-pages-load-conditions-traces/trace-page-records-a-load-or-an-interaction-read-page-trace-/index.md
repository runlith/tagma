---
id: 01a184dc-4fbe-7b01-a2d5-4fae5c99a890
title: trace_page records a load or an interaction; read_page_trace answers its insights from a worker
ord: 2
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a184dc-4fbe-7b01-a2d5-4fa7017d7c9e
---
**Outcome.** Two operations.
- `trace_page {page, action}`:
  - `load` — reloads the page under a trace (`cold` bypasses the HTTP cache) and stops on a fact: the load event followed by a short quiet with no request in flight. The agent names a deadline for a page that never settles; reaching it stops the trace and the answer says the page did not settle.
  - `start` — the agent then acts on the page with the usual tools.
  - `stop` — ends a started trace.
  `screenshots` adds DevTools filmstrip frames; off by default, since insights do not need them and they grow the trace.
- `read_page_trace {trace, set?, insight?, hot?, limit}` — the summary by default; with `insight`, one insight's details; with `hot`, the main thread's hottest functions within a set.

A stop answers the trace id, the file (`.json.gz`, a trace Chrome DevTools opens), duration, the conditions it ran under, whether Chromium reported data loss, and the summary: for each insight set (each navigation, or the whole range) its URL, LCP with its phases, INP and CLS where measured, and the failed insights, each with its estimated saving in one line.

**How.**
- One trace per page: Chromium keeps one tracing session per CDP session, and the engine holds one session per page, so a second start refuses `trace-running`, naming who started the first.
- `Tracing.start` with DevTools' default categories plus JS sampling, `transferMode: ReturnAsStream`, `streamFormat: json`, `streamCompression: gzip`, and a 64 MB trace buffer: Chromium's default 200 MB let one busy page record 436 MB of JSON that parsed at 4.3 GiB, so a fuller recording keeps its start and reports data loss instead. On `tracingComplete` the kit reads the stream with `IO.read` in chunks small enough that one answer stays within the desktop window's input budget (main converts every answer before host code sees it); its payload worker decodes the chunks and appends them to the file. The server never holds the whole trace.
- The analysis worker belongs to the `browser` engine and alone loads `@paulirish/trace_engine` (1.26 MB of JavaScript, pinned): it streams the gzip file, parses events in batches below V8's string limit, runs a fresh model per trace with the conditions as metadata, and writes every insight set, every insight's details and the hot-function ranking into a compact sidecar beside the trace. Then it drops the model. `read_page_trace` answers from the sidecar: no re-parse and no memory held between questions.
- The text is Tagma's own formatter over the engine's typed insight models — one function per insight, naming URLs, elements and milliseconds — not DevTools' AI formatters, which need the frontend core. Insight names are the engine's own (`LCPBreakdown`, `RenderBlocking`, …), so the agent's vocabulary matches DevTools and web.dev.
- Hot functions rank the trace's main-thread CPU samples with `profileFrames` of `@runlith/performance`, which ranks Tagma's own CPU profiles, when the samples convert to its profile shape; a second ranker is not written.
- A trace started by a thread ends with its run under the parent's shared rule and still writes and analyzes its file. A trace whose engine session ended is lost with it: Chromium keeps a trace only inside the CDP session that started it.
- The analysis writes a small summary file and one file per insight set (the first twenty sets, every line bounded), so a read parses only bounded JSON on the server loop.
- On desktop the trace also carries the Electron browser and GPU processes, since `webContents.debugger` is a trusted client; the analysis reads the page's renderer and navigation, and the file stays on the machine like any capture.

**Owners.** `browser` engine and operations; the `@runlith/cdp` stream reader; the engine's analysis worker; `@runlith/performance` for the ranking.

**Acceptance.**
- On a test-server page whose stylesheet the server delays and whose largest image is discovered late, `load` yields an insight set whose LCP breakdown names the image URL and whose render-blocking insight names the stylesheet; `read_page_trace` with `LCPBreakdown` returns its phases.
- `start`, a click on a button whose handler blocks 300 ms, then `stop`: the INP insight names that interaction at 300 ms or more.
- The saved file is gzip JSON with `traceEvents` that the analysis worker reads back.
- A second `start` on a traced page refuses `trace-running`; `read_page_trace` on an unknown id refuses `no-trace`.
- A trace taken under `cpu: 4` names the condition in its summary.
- A trace whose starting run ended is stopped and readable.
- One-sample measurement, machine named: server event-loop lag while a trace over 50 MB uncompressed is transferred and analyzed stays below 50 ms per pass; analysis time and the worker's peak memory are recorded; on desktop, window input lag during the transfer.
