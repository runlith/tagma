---
id: 01a0c70c-01ca-73dd-881f-cfb1b2e75b9c
title: Markdown editor
ord: 44
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "src/bracketRef.ts",
        "for": [
          "8f8b93e1"
        ]
      },
      {
        "at": "src/codec.ts",
        "for": [
          "8f8b93e1"
        ]
      },
      {
        "at": "src/codeLinks.ts",
        "for": [
          "8f8b93e1"
        ]
      },
      {
        "at": "src/extensions.ts",
        "for": [
          "8f8b93e1"
        ]
      },
      {
        "at": "src/MarkdownEditor.svelte",
        "for": [
          "8f8b93e1"
        ]
      }
    ],
    "id": "@runlith/markdown-editor",
    "kind": "kit"
  }
sources:
  - kind: dir
    ref: packages/markdown-editor
---
The document is written right where it is read: the product has no separate read and edit modes, just one editor. The package owns the markdown dialect used to parse the document, reconcile, which carries one person's edit into the stored source so untouched regions keep exact bytes, and the bracket-link atom, which the product turns into a live link. What a link target means, what it shows and where committed bytes go — the callers decide.
