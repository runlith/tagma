---
id: 01a14b1b-14eb-75f6-a49c-4909a308a6b0
title: "Theme: own module instead of mode-watcher with the same storage key"
ord: 14
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a13d48-9aa9-71d0-a2d8-6904612a8cec
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/shared/theme.svelte.ts
---
Build the [[612a8cec|theme]]: module, script in `app.html`, four consumers; `mode-watcher` leaves the dependencies.

Done when: theme unit tests pass, `rg mode-watcher` is empty, `bun check` is clean, commit.
