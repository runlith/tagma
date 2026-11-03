---
id: 01a12c5a-e14b-7f23-b49a-56a5c8041df5
title: A CLI account is its sign-in's address; an unset directory and an explicit home directory persist as different addresses
ord: 3
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a12c46-ab9c-7595-ace5-ac3b69817bc0
sources:
  - kind: file
    ref: apps/tagma/server/src/providers/contract/service/harness.ts
  - kind: file
    ref: apps/tagma/server/src/providers/contract/wire/harnessAccounts.ts
---
A directory account stores the machine and the directory's exact spelling, while credentials stay with the official CLI. A missing directory is stored as `null`: for Claude that is a separate keychain namespace, so expanding a tilde, resolving a symlink or substituting `~/.claude` would change the selected sign-in. The adapter declares the account environment. For a headless status process, retained profile variables are a baseline; the account's exact address and cleared keys remain authoritative. A profile-exported account-place variable creates an explicit directory address with its exact spelling. A later profile change adds an address rather than retargeting the old one; status, launch, borrowing and the login-file watch keep the address they were given. The selected account is written to the session before the process starts, so recovery of an unfinished start and late quota do not depend on a changed default.
