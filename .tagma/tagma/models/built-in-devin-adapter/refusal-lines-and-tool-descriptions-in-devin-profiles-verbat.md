---
id: 01a0c899-1a05-78b2-9c7a-749ca3fd7047
title: Refusal lines and tool descriptions in Devin profiles — verbatim from the records
ord: 1
tags: ["rule"]
fields:
  {
    "enabled": true
  }
sources:
  - kind: file
    ref: packages/adapter-devin/src/profiles/devin.ts
  - kind: file
    ref: packages/adapter-devin/src/profiles/DevinCustomTools.ts
  - kind: symbol
    ref: packages/adapter-devin/src/profiles/devinCustomAgent.generated.ts
    symbol: DEVIN_CUSTOM_AGENT_TOOLS
  - kind: symbol
    ref: packages/adapter-devin/src/profiles/DevinCustomTools.ts
    symbol: resourceServerNotConfigured
  - kind: symbol
    ref: packages/adapter-devin/src/profiles/DevinCustomTools.ts
    symbol: serverNotConfigured
  - kind: symbol
    ref: packages/adapter-devin/src/profiles/DevinCustomTools.ts
    symbol: serverUnavailable
---
