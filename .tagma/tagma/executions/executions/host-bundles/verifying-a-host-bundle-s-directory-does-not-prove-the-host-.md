---
id: 01a0c725-c7d3-747e-b8fe-938a20b0d091
title: "Verifying a host bundle's directory does not prove the host runs it: the host checks its own runtime, entry and library bytes with boundTo"
ord: 2
tags: ["explanation"]
sources:
  - kind: dir
    ref: packages/executions
  - kind: symbol
    ref: packages/executions/src/hostArtifacts.ts
    symbol: boundTo
  - kind: symbol
    ref: packages/executions/src/hostArtifacts.ts
    symbol: verifyArtifact
---
The caller holds the paths it actually runs and `boundTo` compares their real paths with the ones the bundle declares. Directory verification alone can pass while the process runs bytes from elsewhere.