---
id: 01a103df-a0a4-7e9d-914d-dec23b713d78
title: A command's outcome doesn't depend on CPU/RSS metrics being present
ord: 1
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/executions/worlds/shell/results.ts
---
The execution-host verdict and resource accounting answer different questions: missing resource measurement doesn't cancel a confirmed completion. Native metrics are available after reap and travel with the exit, without waiting for cleanup; an unavailable measurement stays `Unmeasured`. Otherwise gathering extra telemetry could turn a successfully executed command into `Unavailable` when the state subscription closes.
