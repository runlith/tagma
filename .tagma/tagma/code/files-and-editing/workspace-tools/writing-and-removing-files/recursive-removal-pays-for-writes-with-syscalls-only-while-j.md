---
id: 01a17db1-6be1-7193-b4f1-6dfa402b03fe
title: Recursive removal pays for writes with syscalls only, while journal, locks, and directory verification pay per batch
ord: 4
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a17d2b-48ac-715a-8c97-6723a90d31cc
sources:
  - kind: file
    ref: packages/agent-tools/src/removal/leaves.ts
  - kind: file
    ref: packages/agent-tools/src/removal/tree.ts
---
`delete -r` must cost no more than two `rm -rf` of the same tree. So write work is reduced to syscalls, and everything else is paid per batch.

Traversal reads a directory with one `readdir` with types. An ordinary file or link from the listing joins the batch by its listing type, without its own `lstat`. Only directories, entries of unknown listing kind, `.git`, and `.gitattributes` are read separately. A batch accumulates across directory boundaries, up to `CHUNK` entries, and flushes early before a directory's `.gitattributes` and `.git` so they leave last.

A batch settles writes at once: one `records` call per batch. It answers from the `Intake.basis` foundation, which for the root directory pre-read ignored paths, and with one request asks the journal about standing lines only for the batch's ignored paths; neither git nor SQL goes into the write. Records outside the journal — outside checkouts, ignored with no standing line, git metadata — are deleted with `unlinkAll` without reading and without verification, as `rm` would delete them: no fact holds onto their bytes. Records under the journal are read in slices, one intention is written per group, deletion goes via `removeAll` with verification, confirmation with one UPDATE.

Batch directories are verified (`sameDirectory`) once under the locks of all its directories and records, not on each record. Locks hold only Tagma writers, so journal records found by traversal re-verify their directory after the slice read: they have no pinned version of their own, and reading a directory swapped by a foreign process would make its files an allowed CAS target. A directory swapped during traversal is dropped together with everything under it not yet traversed. Directories themselves are deleted lazily, in waves, children before parents; before `rmdir` the root also verifies its parent is still the same directory. A wave breaks on one neighbour: in closing order a directory's descendants stand as one solid block right before it, so wave assembly is linear. A batch under the journal lands together with the report in one uninterruptible section: a cancellation after landing would otherwise name deleted records unprocessed.

Cost of the choice: a record outside the journal, swapped between listing and `unlink`, is deleted the same way `rm` would delete it. A record under the journal is deleted with the fact of the bytes read; swapped after reading, it stays standing with a `file-changed` refusal, even with identical bytes.
