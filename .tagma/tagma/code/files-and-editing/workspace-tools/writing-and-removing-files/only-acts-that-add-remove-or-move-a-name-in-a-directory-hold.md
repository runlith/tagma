---
id: 01a17a6d-d613-7cbe-9a02-69a1e9c09ee8
title: Only acts that add, remove, or move a name in a directory hold it; overwriting a standing file holds only the file itself
ord: 2
tags: ["explanation"]
sources:
  - kind: symbol
    ref: packages/agent-tools/src/workspace/runtime.ts
    symbol: withEntryWrite
  - kind: symbol
    ref: packages/agent-tools/src/workspace/runtime.ts
    symbol: withNamedEntry
---
Judging what a write into a directory names — the exact name, another spelling of the same file on a case-insensitive FS, or a free name (`entryIdentity`) — reads the directory with several `stat`s and is not atomic. An act that adds, removes, or moves a name (creation, `delete`, `rename`, `import_output`, creating or deleting a file by line replacement `LineWrites`) judges and acts under the directory lock, so that no other name change in the same directory slips between judgement and write. Otherwise it would answer with an imprecise refusal or a CAS miss instead of the named "other spelling" refusal.

Overwriting the bytes of an already standing file (`edit`, `write`, `strip_comments`, line edits) changes no names and holds only its own file lock. If it held the directory, independent edits to different files in one folder would go one by one, each waiting on another's read, prose stripping, and change-record write. `withEntryWrite` decides the mode by fact: whether an entry stands under the name is checked before the lock and again under the file lock; a name that vanished in between moves the act under the directory lock.

The file lock key is physical: the true parent and the entry name (`entryKey`), the same for every holder. While the directory separated everyone, `rename` through a directory symlink and `edit` of the same file by its true path took different file keys yet still went together; without the directory, different keys would let them run together, and the move's `link`+`remove` could carry the bytes away ahead of the edit just written. A trailing symlink stays its own entry: deleting the link does not hold its target.

Every typed writer takes the same order: the `Intake.turn` queue by place, then the directory, then the file. Tree deletion takes its batch's directories and entries with one `withNamedEntries`: same-rank keys are taken as a sorted set, so two deletions over overlapping directories never wait on each other in a circle. `save_agent`, line rollback, and reshape take the queue outside the write; a tool taking the file lock before the queue would wait on them in a circle, and without ceilings such a circle never resolves on its own.

Remainder: if the name was removed through another spelling (case) after the second check, the act under one file lock may create it again. Creation still goes exclusively through `link`, and other holders' bytes are never overwritten: the race yields a less precise refusal.
