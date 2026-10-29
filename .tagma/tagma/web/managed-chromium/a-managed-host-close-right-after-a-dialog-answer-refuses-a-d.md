---
id: 01a188ff-0d9a-7cde-a936-160eca928684
title: A managed-host close right after a dialog answer refuses "a dialog is open"
ord: 12
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a188e1-c8ab-7dde-911b-e6a59c60187f
sources:
  - kind: file
    ref: apps/tagma/server/src/managed-browser/host.ts
---
Seen once in the combined seed-1 batch (`testbed bun test --no-isolate --randomize --seed=1 ./src/desktop-browser/engine.itest.ts ./src/managed-browser/engine.itest.ts ./src/managed-browser/screencast.itest.ts`, report `/tmp/runlith-test/reports/run.65932.1793299578489.jsonl`). `page audits on the managed Chromium` ran all 20 of its assertions, then `answer_page_dialog accept`, and then its finalizer's `pages.close` refused `host-refused: a dialog is open on page …, and closing it would bypass the answer`.

Inference from the code, red still unproved: `ManagedHost.answer` returns once `Page.handleJavaScriptDialog` replies. `tab.dialog` clears only when the host's event fiber applies `Page.javascriptDialogClosed`, which can come after that reply. So `close(ask)` right after the answer can still see `tab.dialog === true`. The owner's fix would have `answer` resolve only once the host's own dialog state has closed. The task is done when a red through the real door proves this and the fix turns it green.