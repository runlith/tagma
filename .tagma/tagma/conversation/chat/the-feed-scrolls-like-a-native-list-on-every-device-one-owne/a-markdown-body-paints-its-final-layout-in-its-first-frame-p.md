---
id: 01a183c2-b1b4-79d8-a281-31541904c5b6
title: "A markdown body paints its final layout in its first frame: parsing and block layout run synchronously, and only paint-only work such as highlighting lands later"
ord: 6
tags: ["task"]
fields:
  {
    "holder": "tagma:01a183c2-f5c4-7545-b038-bbc8654e0724",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a18327-c7aa-7718-b037-fece2ea21922
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/MarkdownBody.svelte
  - kind: file
    ref: packages/markdown/src/render.ts
---
Found by the real-app feed lane: on opening a thread, assistant rows paint `fallbackBlock` (escaped plain text) first and swap in the parsed body after `MarkdownRenderer.render` resolves, so headings, lists and code blocks change the row's height in the next frame and the visible text moves while the reader does nothing. `render` is async because highlighting runs through `walkTokens`; parsing itself is synchronous. The layout-deciding part — block splitting, Marked parse, sanitizing — answers synchronously and paints first; highlighting (and any other work that only changes colour, not boxes) patches the same blocks later, with code rendered in the same box before and after. The streamed-body contract of 8e06fae1 and the render-key rule c4775464 hold. A late layout change that remains (a reference whose title arrives after paint) is measured by the feed stand's attribution before anything is designed for it.