---
id: 01a117fb-e0ba-7a1f-9859-290575a366f5
title: Code highlighting
ord: 22
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "src/colours.ts"
      },
      {
        "at": "src/offThread.ts"
      },
      {
        "at": "src/session.ts"
      }
    ],
    "id": "@runlith/highlight",
    "kind": "kit",
    "order": [
      [
        "src/theme.ts"
      ],
      [
        "src/colours.ts"
      ],
      [
        "src/worker.ts"
      ],
      [
        "src/grammar.ts"
      ],
      [
        "src/document.ts"
      ],
      [
        "src/session.worker.ts"
      ],
      [
        "src/offThread.ts"
      ],
      [
        "src/session.ts"
      ]
    ]
  }
edges:
  - kind: imports
    to: 01a0c6ed-5b45-77b0-a47b-9e0ab77b7a93
  - kind: imports
    to: 01a0c702-bcab-7b1f-9440-825f382fa6aa
sources:
  - kind: dir
    ref: packages/highlight
---
Code is colored the same in chat, graph bodies, Git diff and the file editor, and this package is the only place where shiki turns text into colors. It owns languages and the theme, whose colors are roles on CSS variables, line limits, the whole-text coloring worker with refusals returned to the main thread, and document sessions that repaint it from the touched line to convergence after an edit; what text to color, whom to give the answer, and how to draw tokens are decided by callers.
