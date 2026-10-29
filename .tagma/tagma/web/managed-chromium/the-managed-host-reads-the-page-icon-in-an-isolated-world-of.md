---
id: 01a1488e-0093-71f5-85e0-06a95e402902
title: The managed host reads the page icon in an isolated world off the service session's event stream
ord: 5
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/managed-browser/host.ts
---
Once the main frame finishes loading, the service session reads `link[rel~="icon"]` or `/favicon.ico` via `Runtime.evaluate` in its isolated world — without `Runtime.enable`, the page never sees it. The read runs on a separate fiber, not in the service session's event stream: a renderer stuck in a dialog or hung never answers evaluate, and waiting in the stream would hold up `javascriptDialogOpening` behind it — an `alert()` from an unattended page would never reach its state.
