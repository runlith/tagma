---
id: 01a1a76d-6014-7281-811f-7045472e54fa
title: The Cursor adapter reads the account token from the macOS Keychain and picks config directories by OS
ord: 5
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a0eaa1-2c4c-7cbd-9014-d7496f758080
  - kind: relates
    to: 01a19ec6-f467-787a-a87e-89cb77c57d56
sources:
  - kind: file
    ref: packages/adapter-cursor/src/quota.ts
---
The quota reader finds the Cursor CLI login by branching on the OS: the macOS Keychain through `/usr/bin/security`, the Windows `APPDATA` directory, or a Unix config directory. The vendor adapter knows three operating systems' credential stores.

Read at ee24295b8e:
- `packages/adapter-cursor/src/quota.ts:29` `/usr/bin/security find-generic-password`; `:48` Keychain on darwin; `:49,51` win32 `USERPROFILE` and `APPDATA`; `:53` darwin `~/.cursor` against the XDG directory.

Done when the adapter asks a credential-store contract for the CLI token, each OS store is a separate adapter composition fills, and the module's OS-independent tests pass on a Linux runner.