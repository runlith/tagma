---
id: 01a0ca9c-1172-7804-affb-6ff184aa1a73
title: A WorkspaceBindings producer is a pure function of its target and never throws
ord: 1
tags: ["rule"]
sources:
  - kind: file
    ref: packages/agent-tools/src/workspace/runtime.ts
  - kind: symbol
    ref: packages/agent-tools/src/workspace.ts
    symbol: WorkspaceBindings
  - kind: symbol
    ref: packages/agent-tools/src/workspace/runtime.ts
    symbol: admitPreparedPath
---
Admission computes the binding when it judges a call and again before the act, and refuses on a difference; a producer that varies or throws breaks that comparison.