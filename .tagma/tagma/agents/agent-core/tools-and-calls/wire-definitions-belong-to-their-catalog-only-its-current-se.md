---
id: 01a19494-9a53-7d4d-826a-5c276982e8fb
title: Wire definitions belong to their catalog; only its current selection is resident
ord: 24
tags: ["explanation"]
sources:
  - kind: symbol
    ref: packages/agent/src/agent/ModelRequests.ts
    symbol: wireToolDefinitions
---
Selection changes reuse the catalog's definitions rather than manufacturing another copy of each tool. Keeping only the current selected array preserves identity for repeated requests without making resident memory grow with every subset the run has used. The weak key lets the wire state become collectable with a catalog no caller holds.