---
id: 01a1a76d-6088-7bfc-b6d6-e0072cf9229a
title: Remote devices locate the Tailscale CLI by per-OS install paths in shared code
ord: 18
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
    ref: apps/tagma/server/src/remote/tailscale/cli.ts
---
The CLI locator falls back to an installed file named per OS after the PATH lookup.

Read at ee24295b8e:
- `remote/tailscale/cli.ts:8-9` the macOS application binary and the Windows Program Files path; `:27` lookup by `process.platform`.

Done when the candidate locations are supplied by an adapter and the module names no OS.