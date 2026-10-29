---
id: 01a12cb5-3ef3-7a2e-94d5-c0b2ffe2dc34
title: An indivisible path keeps the writer chain and carries dependent bytes along with the authors
ord: 4
tags: ["explanation"]
sources:
  - kind: symbol
    ref: apps/tagma/server/src/change-record/lines/fold.ts
    symbol: wholeFile
  - kind: symbol
    ref: apps/tagma/server/src/change-record/prepared/tree.ts
    symbol: planPath
---
An indivisible path keeps the writer chain and carries dependent bytes along with their authors.

A binary file, a too-large file, and a symlink have no line splitting, so the `wholeFile` court can never say whose bytes stand in it. It names as holders every writer of the chain: from the line whose after matches the working file, back over after-to-before matches of the previous line with the next one's before, until HEAD. These are every session on whose uncommitted version the file builds. `standing` is the chain's lines, so a landing with `whole` proves each of them committed.

A landing plan (`planPath`) never cuts such a path: a proven chain of dependent bytes and a program file travel whole with their authors in `carried`. The operator's lines require explicit taking; unknown provenance stays `walk-cut`, with the way out through `whole: [path]`. Automatic dependency judges as the calling delivery, while an explicit whole and a program file keep peer attribution of checks.

The fallback for a text opaque-fold `introduced` takes `lastWriter`, not the chain. There the chain would prove a middle text line committed whose lines may never be in the commit.

The limit: an oversized file's head carries the `blob:<oid>` digest, which never matches the lines' content digests, so the chain never stops at such a head and may name one extra holder before retirement passes.
