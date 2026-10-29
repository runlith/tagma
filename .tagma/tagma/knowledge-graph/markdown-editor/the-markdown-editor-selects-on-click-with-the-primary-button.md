---
id: 01a17596-2609-7864-8a58-249c69caccae
title: "The markdown editor selects on click with the primary button only: right-click does not return focus to it from an open menu"
ord: 2
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/markdown-editor/src/extensions.ts
---
ProseMirror counts any button's release as a click: on release it selects the atom under the pointer (`selectClickedLeaf`) and focuses the editor for it. On macOS and Linux `contextmenu` arrives between right-button press and release, so a menu opened by right-clicking an atom (a `[[…]]` link in a block body) took focus, and the button release returned it to the editor, closing the menu as focus-lost. The `primaryClicks` plugin in `createMarkdownEditorExtensions` takes over non-primary-button clicks, and ProseMirror never handles them. Menu close on focus loss must not be fixed: a menu rightly closes when focus truly left. The price — right-click no longer selects the atom as a node; on Windows `contextmenu` arrives after release, and behavior there would change neither way.
