---
id: 01a1502a-b648-7ab0-905b-5adeb3dd909d
title: One owner in the files package judges a path's on-disk spelling, with Unicode normalization; an unread working file carries a cause
ord: 6
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14a05-5a4d-76a0-b1af-97cb761579da",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a15019-094c-7ef9-b8f4-53aac04c7b50
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/prepared/spelling.ts
  - kind: file
    ref: packages/files/src/working.ts
---
The question "does the path stand on disk in exactly this spelling" was decided in three places: `exactWorkingAt` (`packages/files/src/working.ts`), move pairs through it, and landing (`change-record/prepared/spelling.ts`, `spelledExactly` over listings without normalization). Landing compared names byte for byte: git on macOS yields NFC paths, while a directory entry may stand in NFD (HFS+, a program that created the file in NFD) — then an existing file counted as deleted and its deletion landed in the commit. Not reproduced; concluded from code.

Do: one spelling owner in `@runlith/files` — directory listing and segment walk; a path part matches by exact name, and with other normalization only if the filesystem itself finds the requested spelling (lstat), so two different names do not merge on ext4. Landing and `exactWorkingAt` ask it. `Working.unread` carries the cause (error code), Holdings shows it.

Proof: the files package tests (case, symlink, NFD entry on NFC request), a landing itest with an NFD name, the existing change-record and landing tests.
