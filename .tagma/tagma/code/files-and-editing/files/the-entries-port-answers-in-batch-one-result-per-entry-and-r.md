---
id: 01a17db1-6b82-7762-b963-c274cf1b573d
title: The entries port answers in batch, one result per entry, and `removeAll` checks content then the entry version immediately before deleting
ord: 8
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/files/src/entries.ts
---
The `Entries` port exists so deleting a tree pays per entry only in syscalls: one port call carries a batch of paths, not an Effect, guest channel and span per entry. The machine runs the batch with a promise pool, the Docker world with its own helper operations inside the container. The answer is one `Result` per entry in its position: one entry's failure stays in its slot, neighbours go on.

`removeAll` checks the entry in two steps immediately before deleting. First the content the caller built the fact from: the bytes read, the link target, or the prefix read of a non-text file. Then a fresh `lstat` against the entry's chosen version: kind, device, inode, and for a file also size, mode, mtime and birthtime. The order is deliberate, because reading content can hit an already-swapped file with the same bytes, while the version checked last leaves one syscall to `unlink`. This is not atomic: an entry in that window is lost, like the rest of the race at `replaced`.

`kept: null` checks only the version: this is how entries selected by operands are removed when the journal holds no content of theirs. A missing entry (`absent`) and a different entry in its place (`changed`) are different answers: the caller returns the first as not-found, the second as file-changed. A directory is removed only by `rmdir`: a descendant appearing inside it leaves the directory standing with a refusal instead of going recursive.

`unlinkAll` deletes without checking. It is for entries found by traversal, whose bytes no fact holds; the caller decides that no check is needed.
