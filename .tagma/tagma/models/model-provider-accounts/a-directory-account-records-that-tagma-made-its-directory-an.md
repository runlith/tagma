---
id: 01a1a5f3-4e41-7824-b063-9dbf6b782182
title: A directory account records that Tagma made its directory, and rows stored before the mark are recognised once on read
ord: 36
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a12c5a-e14b-7f23-b49a-56a5c8041df5
  - kind: relates
    to: 01a14c08-22b6-75de-88f8-5bf2a65d1a0a
sources:
  - kind: file
    ref: apps/tagma/server/src/providers/accounts/harnessRows.ts
---
The app names an account's place in words — "Tagma sign-in" for a directory Tagma created, the adapter's default place for the default login, the path only for a directory the person's profile pointed to — so whether Tagma made the directory is a fact the server states in the cli origin (`made`), never a guess from a path prefix. Begin sign-in writes `made` on the row it creates together with the directory. Rows written before the mark carry none; the store's decoder marks a row whose directory lies under Tagma's data home and is named by the account key — the only directories begin creates, since the key is a random UUID — and writes the file back once, so after that read the row itself carries the fact. The origin also carries `shown`, the directory with the user's home spelled `~`, because only the server knows that home; `place` stays the exact address that reveal and copy use.