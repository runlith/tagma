---
id: 01a116a3-9bf1-778a-874b-f87855647532
title: Attachment hydration re-reads every image from disk on every model request
ord: 10
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a1167b-7785-79ac-bda1-de452b7619a8
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/resources/attachments.ts
  - kind: file
    ref: packages/agent/src/thread/run/ThreadTail.ts
---
`ThreadAttachmentStore.hydrate` reads every history image (and the markdown document from old steer messages) from disk in full on every model request, with no memory between steps of one run. Reviewer estimate (muse-performance, commit d6e19a61b0, not a measurement): five 2 MB images over 50 steps — about 500 MB of reads and as much allocation for bytes that never changed. `ThreadTail` (`packages/agent/src/thread/run/ThreadTail.ts:26-30`) re-substitutes the suffix on every single-message shift when trimming on overflow.

Cost must grow with what changed: image bytes are read once per run or cached by id with a memory bound, and trimming substitutes history at most once.

Done when a repeat request of the same run does not re-read already-read images and trimming substitutes history no more than once; a before/after measurement on a thread with several images.
