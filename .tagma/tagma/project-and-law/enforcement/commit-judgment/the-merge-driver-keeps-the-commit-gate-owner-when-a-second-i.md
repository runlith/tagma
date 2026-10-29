---
id: 01a123cd-1c1a-73ff-a7cf-6a2f5bae44c1
title: The merge driver keeps the commit gate owner when a second install registers
ord: 2
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/enforcement/commits/mergeDriver.ts
  - kind: symbol
    ref: apps/tagma/server/src/enforcement/commits/hooks.ts
    symbol: installCommitHooks
  - kind: symbol
    ref: apps/tagma/server/src/enforcement/commits/hooks.ts
    symbol: uninstallCommitHooks
  - kind: symbol
    ref: apps/tagma/server/src/enforcement/contract/wire/gateHook.ts
    symbol: gateStanding
---
Commit hooks and the merge driver name the owning install by its data directory and use one ownership decision. With a gate installed, the hooks result wins and lets startup restore its own driver even when it was redirected to another install. When managed hooks can't be installed, including with an external or missing `core.hooksPath`, the driver script itself carries the owner so a second install keeps it together with attributes and git config. A vanished install yields to the remaining one under the same rule.
