---
id: 01a0c71c-6402-75fa-979c-b13553a8d5dc
title: A managed call's outcome is read from `ManagedCall.result`, not from the exit code
ord: 7
tags: ["rule"]
sources:
  - kind: file
    ref: packages/executions/src/executionSpawner.ts
  - kind: file
    ref: packages/executions/src/ManagedCall.ts
  - kind: symbol
    ref: packages/executions/src/ManagedCall.ts
    symbol: managedCall
  - kind: symbol
    ref: packages/executions/src/ManagedCall.ts
    symbol: ManagedCall
---
Completion and reason live in result: CallDecisionAnswer; a child's zero exit code does not override a cancel or deadline decision.
