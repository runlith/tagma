---
id: 01a1183a-479a-71bc-8c23-4ed90c9ab333
title: "checkout-files hot-path thresholds: what is computed on the event loop, what in the worker, and why"
ord: 2
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/checkout-files/documents/edits.ts
  - kind: file
    ref: apps/tagma/server/src/checkout-files/listing/directory.ts
  - kind: file
    ref: apps/tagma/server/src/checkout-files/worker/client.ts
---
What `checkout-files` counts on the event loop and what in the worker is decided by thresholds, each named here by its reason, not by its number.

- A document diff runs on the loop only while the text is small in characters and, after cutting the shared head and tail, few lines remain: the worst inline case (lines with no matches) must fit under the noticeable-delay threshold on the weakest machine, and cost grows faster than length, so the threshold counts lines, not file size. Above the threshold the worker counts the diff; its unavailability or an answer ceiling yields `whole`, never a lost write.
- Directory order sorts on the loop while the directory is small, in the worker above it: sorting with numeric name comparison grows faster than length.
- A `read_directory` page takes the sorted listing from the cursor's first page while the directory has not shifted (inode and modification time); only a bounded number of listings is held, because only the listing currently paged through is needed.
- The count of concurrent link and document reads derives from the machine's core count: this is I/O, and more parallel reads than cores only take descriptors without speeding up.
- Paths per one `git ls-files` over events are bounded by the command-line length: a path batch must never hit the OS argument limit, so the batch is sliced.
- Closing the index and the watcher after the last reader leaves is one cancellable timer per record; a repeated question reschedules it instead of starting a new fiber.
- A worker request is bounded by an answer ceiling: a stuck worker gets waiting callers a refusal, and the worker restarts. A stale question the worker never started is dropped by it on the cancel flag in shared memory.
