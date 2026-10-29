---
id: 01a10caa-d102-72b9-acdd-b532ea379db4
title: The shelf remembers publishing threads in a per-thread file, not in the version manifest
ord: 2
tags: ["explanation"]
sources:
  - kind: symbol
    ref: apps/tagma/server/src/artifacts/storage.ts
    symbol: VersionedShelf
---
`threads/<sha256 of thread>` under the shelf root is the list of page ids the thread has ever published; a line is appended on the first publication of a page from this thread. That is how the "team pages" answer reads only team pages instead of walking the whole shelf, and the version manifest never changes shape. The file name is a hash, so a request thread id never becomes a path from the feed. A page republished from another thread lies in both files; when a team reads, it goes to the thread named first in the request — the app puts the open thread first. Files are never cleaned with versions: an id with no current version is simply skipped on read.
