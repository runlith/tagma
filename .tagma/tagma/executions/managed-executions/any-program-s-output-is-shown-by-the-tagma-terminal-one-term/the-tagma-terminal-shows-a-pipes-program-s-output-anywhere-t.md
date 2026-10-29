---
id: 01a15c3b-a6c0-7483-b281-a1b8403e7819
title: The Tagma terminal shows a pipes program's output anywhere; the stdout/stderr output window is deleted
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15ac1-2b9a-7fc6-b993-3b1f606e8186",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a15c3b-48c4-7846-8c30-4f17497a5e13
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/executions/terminal/Pane.svelte.ts
---
Spec [[497a5e13]] parts 2–5 in the app: the Output source in `TerminalPane`, the shared off-tab terminal registry instead of `ThreadPanes`, a bottom-panel tab for a held pipes program, the built-in terminal in the feed card and the thread operations popover; the stdout / stderr output window is deleted.
