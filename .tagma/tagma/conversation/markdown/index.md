---
id: 01a0c6fb-b410-708c-90b9-4d9ac686d8c2
title: Markdown
ord: 31
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "src/render.ts",
        "for": [
          "8f8b93e1",
          "cb732496"
        ]
      }
    ],
    "id": "@runlith/markdown",
    "kind": "kit"
  }
edges:
  - kind: imports
    to: 01a0c702-bcab-7b1f-9440-825f382fa6aa
  - kind: imports
    to: 01a117fb-e0ba-7a1f-9859-290575a366f5
sources:
  - kind: dir
    ref: packages/markdown
---
Runlith draws bodies in markdown — chat answers arriving token by token, transcripts, diffs — and this package is the one place where such text turns into safe HTML. It cuts the growing body into finished blocks and one tail, parses it with Marked, cleans with DOMPurify and highlights code via `@runlith/highlight`. Which theme, which body a render belongs to and what the product's own inline forms mean — the callers decide.
