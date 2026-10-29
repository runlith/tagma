---
id: 01a1357e-e0d8-7396-900c-f9b9bff450d7
title: Landing holds retirement's automatic passes until a fresh judge; an explicit pass only takes preceding signals
ord: 4
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a1353c-1ac5-7092-9d08-65149d137830
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/retire/passes.ts
  - kind: file
    ref: apps/tagma/server/src/landing/land/submit.ts
  - kind: symbol
    ref: apps/tagma/server/src/change-record/retire/driver.ts
    symbol: Retirer.follow
---
Landing holds retirement's automatic passes until a fresh judge; an explicit pass only takes preceding signals.

The lease suspends requests from the HEAD watch, clean Holdings verdicts and command-window closing while landing publishes the commit, applies reshape and re-judges the paths. An explicit pass takes signals up to the start of input reading; later ones stay for the next pass after release, including on landing failure or interruption. Signal work belongs to the retirement scope, so removing the HEAD subscription never interrupts its own line exit. The published commit itself never replaces reading the current HEAD: an external write may have shifted it before retirement.
