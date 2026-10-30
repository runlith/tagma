---
id: 01a0c6fb-b455-7f34-80b0-0dc2c4775464
title: Pass the same `key` to `MarkdownRenderer.render` for as long as one body grows
ord: 7
tags: ["rule"]
sources:
  - kind: dir
    ref: packages/markdown
  - kind: symbol
    ref: packages/markdown/src/render.ts
    symbol: MarkdownRenderer
---
Without a key the renderer digests the text, so each growth step starts a new body and redraws finished blocks.