---
id: 01a1373c-736f-7a25-8b32-081b75de56d3
title: The active server lock is taken after the data directory lock and released before it
ord: 5
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/junction.ts
  - kind: file
    ref: apps/tagma/server/src/installation/setup/active.ts
  - kind: file
    ref: apps/tagma/server/src/platform/lock/recorded.ts
---
`active.lock` at the junction (`~/Library/Application Support/Tagma/`) is one per account for both channels, `server.lock` belongs to each data directory. The successor on restart waits for the predecessor's `server.lock` (`standBy`) and only then takes `active.lock`. So the predecessor releases `active.lock` before `server.lock`: in the reverse order the successor would get `channel-active` from its own predecessor.

`active.json` is written through tmp and rename already under the lock, and deleted on release only when it holds our pid. Readers without flock — the sh entry point and the window on Electron — then see a whole record. After kill -9 the record stays though the lock is free. So they check its pid: the entry point through `kill -0`, the window through `process.kill(pid, 0)`. Only the flock holder decides the holder: the CLI and the server.
