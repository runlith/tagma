---
id: 01a118ce-1d24-7def-aea2-5ee79dddba66
title: "The operator's save runs under the document cell lock: its own record's frame carries its id, and the same record's file event stays silent"
ord: 4
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/checkout-files/documents/open.ts
  - kind: file
    ref: apps/tagma/server/src/checkout-files/writing/document.ts
---
The operator's save runs under the document cell lock: the frame of its own record carries its id, and the same record's file event stays silent.

`write_document` takes the intake queue on the path, then the open cell's lock, and only under it reads the bytes, checks `base`, writes, and shifts the cell. Without the lock, a watcher update would have broadcast the same write without the `write`, and the editor would apply its own lines twice.

- If the cell lagged behind disk (someone else's write has not arrived as an event yet), first a frameless "before write" goes out, then the write's frame with the id — so the echo holds only the operator's write.
- `write` is the id the client picks: the frame can arrive over the live channel before the HTTP answer, and the client would have nothing to match it against.
- The stat key after the write is never remembered: a later event reads the file, sees the same digest, and yields no frame. The read is extra, but a key taken after the write could pin someone else's bytes to ours.
- The cell state remembers the record id that produced it. So `whole` from `prime` and from folding a lagged backlog carries `write` until nothing has changed since that record.
- A missing file whose path the change record knows as a move source (`movedTo`, a standing line with `movedFrom`) becomes the `moved {path}` state if the target stands, `gone` otherwise. A new subscriber gets the same. A read failure on `movedTo` yields `unreadable`, and the next event asks again.
- A path through a symlink writes at the real target inside the checkout, and the fact lands under it. A target outside, `.git`, and an absolute path refuse in `Targets.of`, shared by documents and tree-record operations.
