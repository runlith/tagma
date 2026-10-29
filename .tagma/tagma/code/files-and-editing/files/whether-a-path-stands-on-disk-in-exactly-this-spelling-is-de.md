---
id: 01a15039-56c4-79b7-89ab-762137cb37cc
title: "Whether a path stands on disk in exactly this spelling is decided by one `standing` in the files package: the exact name in the directory listing, and another Unicode spelling only if the filesystem itself finds what was requested"
ord: 7
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a1502a-b648-7ab0-905b-5adeb3dd909d
sources:
  - kind: symbol
    ref: packages/files/src/working.ts
    symbol: standing
---
Holdings (`exactWorkingAt`), move pairs and landing ask one question, and each used to answer in its own way: stat on a case-insensitive FS finds `Theme.ts` by `theme.ts`, while byte comparison of the listing misses an NFD entry by the NFC path git hands out on macOS. The first left a deleted path ownerless, the second landed the deletion of an existing file into the commit.

The rule: every segment is looked up in its own directory's listing. An exact name stands; a name equal only after NFC stands only if lstat of the requested spelling succeeds: so APFS/HFS+ accept the NFD entry, while on ext4 two different names never merge. Case is never folded. A directory that cannot be read answers `unread` with a reason, not "yes" or "no": landing then refuses, Holdings answers unknown.

Listing is asynchronous and cached for one caller pass (the Holdings probe, `movesAt`, one landing); the normalized name set is built only on an exact-name miss. A path is relative, with `/`, as git writes it.
