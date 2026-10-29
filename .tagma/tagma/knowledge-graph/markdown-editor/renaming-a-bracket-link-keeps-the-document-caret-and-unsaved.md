---
id: 01a174c8-2edd-7250-9dff-cc41de03e0e0
title: Renaming a bracket link keeps the document, caret and unsaved text
ord: 1
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/markdown-editor/src/bracketRef.ts
  - kind: file
    ref: packages/markdown-editor/src/MarkdownEditor.svelte
---
External target names change independently of the document. Reading them at editor creation does not become a lifetime dependency; updating link views neither replaces the editor nor writes into the document. Otherwise an arriving live name recreates the editor along with the caret and unsaved edits.
