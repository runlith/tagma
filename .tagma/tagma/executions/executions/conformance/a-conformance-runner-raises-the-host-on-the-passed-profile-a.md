---
id: 01a0c71b-21c7-7a01-a7a6-ee3ffd1c786c
title: A conformance runner raises the host on the passed profile and proves it is the one answering
ord: 1
tags: ["rule"]
sources:
  - kind: dir
    ref: packages/executions/src/conformance
  - kind: symbol
    ref: packages/executions/src/conformance/hostConformance.ts
    symbol: describeHostConformance
  - kind: symbol
    ref: packages/executions/src/conformance/hostConformance.ts
    symbol: HostConformanceRig
---
The first case cross-checks the welcome installation against the passed profile and demands an empty inventory. Limits and reserve count on the passed profile.
