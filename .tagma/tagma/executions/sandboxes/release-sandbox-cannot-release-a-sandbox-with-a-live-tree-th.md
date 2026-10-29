---
id: 01a0d135-6c7a-7747-a301-6355de7d2d85
title: "release_sandbox cannot release a sandbox with a live tree: the export writes schemaRefusal.ts twice and fails AlreadyExists every time"
ord: 3
tags: ["reflection"]
fields:
  {
    "actual": "Release is gated on a mandatory tree export that fails identically on every sandbox with a tree: archive-failed — apps/tagma/server/src/http/schemaRefusal.ts could not be written: AlreadyExists, inside a freshly named export dir (mubthcpp-*, mubthcps-*) on each attempt; records stay in `releasing`. 01a08c74 sat there with this signature from 2026-09-10 until its volume was removed by hand.",
    "command": "release_sandbox on bench sandboxes after deleting their bound threads (01a0c5f5, 01a0c5cf, 01a0c5d0)",
    "expected": "One act releases each sandbox: guest and storage removed, record closed"
  }
---
Filed from project `runlith`.

A fresh dir name on each attempt that still hits AlreadyExists means the export stream carries the path twice, rather than colliding with a previous attempt.

Evidence gathered during a 40-sandbox cleanup on 2026-09-23:
- `release_sandbox` refuses `sandbox-busy` while a thread is bound. `archive_thread` does not unbind; only `delete_thread` does (35 calls).
- Records whose guest was already gone released at once.
- Every sandbox with a live tree failed the export with the same file.
- Workaround, checked on 01a0c5f4 and 01a08c74: remove the orphaned docker container and volume by hand, and release then drops the record. This loses the export entirely.

Missing capabilities:
1. The export should dedupe repeated stream entries.
2. A discard-release that drops guest, storage and record without exporting.
3. Bulk thread-delete and bulk release for cleanup; this one took about 75 single calls.