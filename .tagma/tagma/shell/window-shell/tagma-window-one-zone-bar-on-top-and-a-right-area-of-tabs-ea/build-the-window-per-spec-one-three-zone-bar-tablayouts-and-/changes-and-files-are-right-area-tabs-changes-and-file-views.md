---
id: 01a15644-1cec-7a45-a596-1e8d9a54ca02
title: "Changes and files are right-area tabs: `changes` and `file` views; `OpenFile`, the diff seam in `ThreadMain`, and the `FilesColumn` go away"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15644-a1c7-72e1-bc59-b080803f66a9",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a15622-e2ef-7840-b59b-5e32e200e09f
---
Part of [[e200e09f]]: `changes` views (the thread's change list and the selected file's diff in one tab, ↑/↓ over neighboring files, repeated click closes the diff, thread/base lenses, commits, FinishStrip) and `file` (a file or diff from the feed, links, palette; id is `rootId+path+commit+lens`, id and line stored) are declared in `features/checkout`. A Changes tool with counter in zone B, "+" items Changes and File… ⌘P. `FileOpener` opens a `file` tab instead of a thread stage. Proof is typecheck, owner tests, deleted `OpenFile`, `FilesColumn`, and the seam in `ThreadMain`.
