---
id: 01a179c9-bfb4-76ab-8a43-403f97ecb9a9
title: The desktop main process reports all surface webContents crashes, their preload errors, and its own exceptions to report_faults
ord: 5
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: implements
    to: 01a179c9-bfb4-76ab-8a43-403ac8860d90
  - kind: waits-on
    to: 01a179c9-bfb4-76ab-8a43-403d8936b239
sources:
  - kind: file
    ref: apps/tagma/desktop/src/main.ts
  - kind: file
    ref: apps/tagma/desktop/src/projectWindows.ts
---
`render-process-gone` of project windows, view windows, and the dictation pill (cause, exit code, last address), their preload errors, and the main process's `uncaughtException` and `unhandledRejection` leave with `origin: desktop`. The sender is like the window's: one batch in flight, a bounded queue, past the ceiling — a `desktop` loss.
