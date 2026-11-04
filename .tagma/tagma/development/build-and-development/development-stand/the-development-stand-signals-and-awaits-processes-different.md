---
id: 01a1a76d-6037-776b-8ddc-ccfd1926f3e6
title: The development stand signals and awaits processes differently on win32 in shared code
ord: 15
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
    ref: packages/dev-runner/src/index.ts
---
The runner stops a stack's children with process-tree signalling on POSIX and plain `child.kill` with an exit wait on Windows.

Read at ee24295b8e:
- `packages/dev-runner/src/index.ts:226` `signalChild` and `:257` `waitForStop` branch on `win32`.

Done when the process-tree stop is an adapter behind a contract and the runner's tests pass on a Linux runner.