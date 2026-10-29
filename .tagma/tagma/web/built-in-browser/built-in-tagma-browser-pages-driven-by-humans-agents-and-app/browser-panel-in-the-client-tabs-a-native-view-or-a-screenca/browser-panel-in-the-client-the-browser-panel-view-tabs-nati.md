---
id: 01a147d6-7ef4-7c9c-9e39-fead0c7f376c
title: "Browser panel in the client: the browser panel view, tabs, native PageView, link router, keyboard map, element to chat, settings section"
ord: 1
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a147b0-e165-75df-b2b0-9a0fe3064958
  - kind: waits-on
    to: 01a147d6-7ef4-7c9c-9e39-feaa461a081e
  - kind: waits-on
    to: 01a147d6-7ef4-7c9c-9e39-feab93cb7437
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/features/browser
---
Implement [[e3064958|the browser panel]]: the `browser` panel view and two `SidePanes` edits (switching any view's content, opening only when there is room), the tab strip over the `browser.pages` feed, the `PageView` port with a native adapter and a bridge-host-id predicate, the keyboard-map service, the link router, page dialogs, browser-tool feed cards, pick mode and chat attachment, the "Browser" section with profiles, default profiles, and desktop identity. The screencast adapter lives in the screencast task.

Done when: the spec's client-contract tests pass; `bun run typecheck` is clean; review is done; the commit goes through `submit_work`.
