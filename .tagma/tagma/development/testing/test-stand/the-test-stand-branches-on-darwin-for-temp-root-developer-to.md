---
id: 01a1a76d-6054-727b-8509-3e3760c203e8
title: The test stand branches on darwin for temp root, developer tools, caches and database holders
ord: 33
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
    ref: packages/testbed/src/core/run.ts
  - kind: file
    ref: packages/testbed/src/core/watch.ts
---
The stand has per-OS process readers under `src/core/processes/` (`darwin.ts`, `linux.ts`, `ps.ts`) chosen in one switch in `processes.ts:34`; those are adapters and fine. The run setup and the sweep still carry OS knowledge in shared stand code.

Read at ee24295b8e:
- `packages/testbed/src/core/run.ts:9` the temp base is `/tmp` on darwin; `:152-163` Xcode `xcode_select_link` and Command Line Tools directories; `:199,202` Bun cache under `Library/Caches` on darwin; `:210-212` the Playwright cache by darwin, win32 and XDG.
- `packages/testbed/src/core/watch.ts:403` the database-holder scan runs `/usr/sbin/lsof` only on darwin.

Done when run setup reads a per-OS environment provider the stand fills, the stand's own tests need no macOS paths, and they pass on a Linux runner.