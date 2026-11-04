---
id: 01a1a76d-605c-7269-b3ad-1e3c3a845adb
title: The server foundation hardcodes macOS durability, clone and descriptor-limit behaviour beside the other OSs
ord: 50
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
    ref: apps/tagma/server/src/platform/store/open.ts
  - kind: file
    ref: apps/tagma/server/src/platform/store/snapshot.ts
  - kind: file
    ref: apps/tagma/server/src/platform/store/snapshotFiles.ts
  - kind: file
    ref: apps/tagma/server/src/platform/durable/files.ts
  - kind: file
    ref: apps/tagma/server/src/platform/durable/flush.ts
  - kind: file
    ref: apps/tagma/server/src/platform/durable/flush.worker.ts
  - kind: file
    ref: apps/tagma/server/src/platform/durable/clone.ts
  - kind: file
    ref: apps/tagma/server/src/platform/watch/limits.ts
---
The foundation that every server module stands on decides storage durability, tree cloning and descriptor limits by OS in its own files. Full-fsync is a macOS worker over `libc.dylib`, clone shells out to `cp -Rc` on darwin, and the descriptor limits are a darwin/linux table.

Read at ee24295b8e:
- `platform/store/open.ts:212` and `platform/store/snapshot.ts:534` `fullfsync` when `darwin`.
- `platform/store/snapshotFiles.ts:30` and `platform/durable/files.ts:38` skip directory fsync on win32.
- `platform/durable/flush.ts:14` route `worker` on darwin, `fsync` elsewhere; `:79` the worker starts only on darwin; `:117` the route is read again; `platform/durable/flush.worker.ts:9` `dlopen('libc.dylib')` and `F_FULLFSYNC`.
- `platform/durable/clone.ts:42,44` `cp -Rc` clone on darwin, Node `cp` elsewhere.
- `platform/watch/limits.ts:24-31` darwin and linux table of `getrlimit` numbers, libc names and descriptor directories; `:86,95` lookup by `process.platform`, `/proc/sys/fs/inotify/max_user_watches` on linux.

Done when durability, clone and limits are ports the foundation declares, the macOS implementations are adapters composition fills, and the foundation's tests pass on a Linux runner.