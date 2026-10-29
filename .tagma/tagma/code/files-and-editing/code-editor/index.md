---
id: 01a1182a-139a-73e6-8a1a-6afa1dfa3fad
title: Code editor
ord: 23
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "src/document.ts"
      },
      {
        "at": "src/marks.ts"
      },
      {
        "at": "src/Editor.svelte"
      },
      {
        "at": "src/Diff.svelte"
      }
    ],
    "id": "@runlith/code-editor",
    "kind": "kit",
    "order": [
      [
        "src/marks.ts",
        "src/lineChanges.ts"
      ],
      [
        "src/document.ts",
        "src/settings.ts"
      ],
      [
        "src/extensions/"
      ],
      [
        "src/FindLayer.svelte"
      ],
      [
        "src/Editor.svelte",
        "src/Diff.svelte"
      ],
      [
        "stand/"
      ]
    ]
  }
edges:
  - kind: imports
    to: 01a0c6ed-5b45-77b0-a47b-9e0ab77b7a93
  - kind: imports
    to: 01a117fb-e0ba-7a1f-9859-290575a366f5
  - kind: imports-tests
    to: 01a0c704-a612-7c4c-9f81-5089acc2829b
  - kind: imports-tests
    to: 01a1835e-fd16-7556-8288-d03ba287d79f
sources:
  - kind: dir
    ref: packages/code-editor
---
The operator edits and reads the checkout's files in a VS Code-level editor while agents write to the same files, and this kit is the only place where Tagma renders code on CodeMirror 6. It owns the document with unsaved edits over base, which merges disk edits outside the operator's undo and answers conflict only on overlapping lines; editor and diff views over ready-made server lines; viewport highlighting through the `@runlith/highlight` session; gutters for numbers, holders and line marks; the overview ruler, search and the standard's CSS-variable theme. The server protocol, autosave, conflict as product state, tabs and mark meanings belong to the caller.
