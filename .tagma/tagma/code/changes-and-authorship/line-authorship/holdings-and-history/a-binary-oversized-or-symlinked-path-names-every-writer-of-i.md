---
id: 01a12cb5-3ef3-7a2e-94d5-c0b2ffe2dc34
title: A binary, oversized or symlinked path names every writer of its version chain
ord: 4
tags: ["explanation"]
sources:
  - kind: symbol
    ref: apps/tagma/server/src/change-record/lines/fold.ts
    symbol: wholeFile
---
A binary file, a too-large file and a symlink have no line splitting, so the `wholeFile` court can never say whose bytes stand in it. It names as holders every writer of the chain: from the row whose after matches the working file, back over after-to-before matches of the previous row with the next one's before, until HEAD. These are every session on whose uncommitted version the file builds. `standing` is the chain's rows, so retirement keeps each of them held until HEAD carries the bytes.

The fallback for a text whose fold went opaque (`introduced`) takes `lastWriter`, not the chain: the chain would prove a middle text version committed whose lines may never be in the commit.

The limit: an oversized file's head carries the `blob:<oid>` digest, which never matches the rows' content digests, so the chain never stops at such a head and may name one extra holder before retirement passes.
