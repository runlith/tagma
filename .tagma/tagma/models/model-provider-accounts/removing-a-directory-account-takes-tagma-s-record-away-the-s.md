---
id: 01a12c7d-fbce-7d8a-a0ae-ad880f3be72e
title: Removing a directory account takes Tagma's record away; the sign-in and terminal stay with their owners
ord: 4
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a12c46-ab9c-7595-ace5-ac3b69817bc0
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/accounts/cli.ts
  - kind: file
    ref: apps/tagma/server/src/providers/accounts/harnessAccounts.ts
---
Tagma stores the official sign-in's address, so removing its record removes neither the CLI directory nor revokes its grant: the same sign-in can serve the SDK, the terminal and a borrowing provider. The sign-in terminal is opened by the operator as a held process and ends through the CLI itself or the operator's action; the account record's lifetime does not govern it. This independence covers account-record removal: an explicit Cancel cancels the sign-in attempt itself and its terminal, keeping the previous account on reconnect.
