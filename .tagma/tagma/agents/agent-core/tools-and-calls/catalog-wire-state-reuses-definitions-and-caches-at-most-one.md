---
id: 01a19494-9a53-7d4d-826a-5c276982e8fb
title: Catalog wire state reuses definitions and caches at most one selected subset
ord: 24
tags: ["explanation"]
sources:
  - kind: symbol
    ref: packages/agent/src/agent/ModelRequests.ts
    symbol: wireToolDefinitions
---
Each catalog owns one definition per tool and caches at most one subset array and key. Consecutive calls selecting the same subset reuse that array until another selection or a full-catalog call replaces it; definition identities remain shared across subsets. In-flight callers can keep the arrays they already received. The weak key lets cache-owned wire state become collectable with a catalog no caller holds.