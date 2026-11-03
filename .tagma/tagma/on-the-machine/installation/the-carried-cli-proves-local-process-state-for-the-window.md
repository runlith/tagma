---
id: 01a1a26f-9a35-7ac4-900d-c2f0c40c9da0
title: The carried CLI proves local process state for the window
ord: 79
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/installation/contract/wire/probe.ts
  - kind: file
    ref: apps/tagma/server/src/installation/process/record.ts
  - kind: file
    ref: apps/tagma/server/src/installation/cli/server.ts
  - kind: file
    ref: apps/tagma/desktop/src/server.ts
  - kind: file
    ref: apps/tagma/server/src/installation/setup/active.ts
  - kind: file
    ref: apps/tagma/server/src/installation/process/probe.ts
---
The window asks its carried CLI for directory-lock ownership and restart liveness, so Electron reads no native process ABI. The process reader binds current records to kernel birth witnesses and qualifies issued records against their recorded start; a raw PID is never sufficient to keep a restart alive. A participant the reader cannot measure makes the probe unproven rather than ended, and keeps a CLI restart wait open instead of concluding that nobody restarts; every reader of the restart record therefore requires the native reader. A failed probe remains unavailable rather than telling the window that the directory is free.