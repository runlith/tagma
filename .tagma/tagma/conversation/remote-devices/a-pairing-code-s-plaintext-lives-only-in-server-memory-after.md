---
id: 01a10c6e-f970-7cb8-9ddd-88ac15c5d839
title: A pairing code's plaintext lives only in server memory; after a restart create_pairing issues a new code
ord: 1
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/remote/keeper.ts
---
The `pairing` table holds only the code's SHA-256, and a repeated `create_pairing` must return the same code so two open settings pages do not cancel each other's codes. So the standing code's plaintext is held by the `makeKeeper` closure in memory. After a server restart there is nothing left to show the stored line with, and the next `create_pairing` issues a new code, deleting all `pairing` lines: one code still applies to the installation.

The wrong-exchange budget also lives in memory and resets on restart. Only the operator restarts, so this cannot speed up code guessing.
