---
id: 01a1a76d-603d-74df-b874-6720f089635a
title: The file-lock kit keeps a table of per-OS libc names and errno constants
ord: 1
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
    ref: packages/file-lock/src/flock.ts
---
The kit's one file loads libc through FFI and holds both operating systems' library names, `ioctl` close-on-exec codes, errno accessor and would-block numbers in a `darwin`/`linux` table; any other OS throws. The same libc table is copied in `apps/tagma/server/src/installation/process/lifetime.ts`, `apps/tagma/server/src/platform/watch/limits.ts` and `apps/tagma/server/src/platform/durable/flush.worker.ts`.

Read at ee24295b8e:
- `packages/file-lock/src/flock.ts:18` darwin entry, `:19-25` linux entry, `:39-40` lookup by `process.platform`.

Done when the kit declares an advisory-lock contract, each OS is an adapter (a shared libc-binding adapter if several modules need one), and the kit's tests pass on a Linux runner.