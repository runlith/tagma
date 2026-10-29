---
id: 01a14ade-3211-7508-8c89-3000238c537b
title: Agent names in “still editing” under the commit button link to their threads
ord: 6
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14ac9-fd71-7bf7-86d9-805862f6ffd9",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a0d00d-0437-72e1-8ad5-b5c4dcabc620
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/CommitBox.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/threadGroups.ts
---
The line under the commit button in the Git tab names the threads still writing to staged files, but the names are plain text. Each thread name becomes a link that opens the thread alongside in its home; `You` stays text. With up to three writers all are shown; with more, the first three by file count plus “and N more”, which expands the same line into all links.

Start with `stillEditing` in `checkout/threadGroups.ts`: it returns writers with file counts instead of a ready phrase, and `CommitBox.svelte` assembles the phrase. Proof is the app typecheck and the line in the UI.
