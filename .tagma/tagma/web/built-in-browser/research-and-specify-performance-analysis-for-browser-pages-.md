---
id: 01a184cf-1978-7f1d-bc2e-e63f3fb779ad
title: "Research and specify performance analysis for browser pages: traces with insights, CPU and network throttling, Lighthouse, heap snapshots, recording"
ord: 16
tags: ["task"]
fields:
  {
    "holder": "tagma:01a184cf-76db-7675-94b3-bb127349a2f3",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a14c08-1c3f-7bde-a2e3-046726716824
  - kind: relates
    to: 01a184dc-4fbe-7b01-a2d5-4fac647a38eb
---
The largest gap of the built-in browser's agent tools against chrome-devtools-mcp is performance work: a performance trace with analysed insights, CPU and network throttling, a Lighthouse audit, a heap snapshot, and recording the agent's session to video. chrome-devtools-mcp builds traces on DevTools frontend's trace engine and bundles Lighthouse (`.external/chrome-devtools-mcp`). Read how it does each, what it costs (dependency size, runtime cost, CDP domains it enables and what sites can detect), and what of it works through our engine on both hosts (Electron 44.8 `webContents.debugger` and managed Chromium over a pipe). Record the reading as #research under this module, then write a #spec for what we build, which owners it touches and how it is proved; implementation is separate work.