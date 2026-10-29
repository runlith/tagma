---
id: 01a14a18-6565-7906-8978-417217f3ed53
title: "Kit layer stack: build to spec and move the dialog and the app popup onto it"
ord: 1
tags: ["task"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: implements
    to: 01a13d48-9aa9-71d0-a2d8-68fc313c7343
---
Build the [[313c7343|layer stack]] whole: depth, closing, `place`, tracking, portal, presence, focus, scroll-lock; move the dialog and every app popup, delete what the spec deletes. Immediately add what [[6e97df1d|native page freeze]] waits for: rectangles of open layers, the notifications step rectangle, and the intent-to-open-layer signal — and write it into the stack spec.

Done when: the spec's performer checks (unit, jsdom) pass, the existing dialog tests pass on the stack, `bun run typecheck` is clean, commit via `submit_work`.
