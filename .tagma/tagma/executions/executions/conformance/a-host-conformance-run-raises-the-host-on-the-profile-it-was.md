---
id: 01a0c71b-21c7-7a01-a7a6-ee3ffd1c786c
title: A host conformance run raises the host on the profile it was given and proves in its first case that this host is the one answering
ord: 1
tags: ["rule"]
sources:
  - kind: symbol
    ref: packages/executions/src/conformance/hostConformance.ts
    symbol: describeHostConformance
  - kind: symbol
    ref: packages/executions/src/conformance/hostConformance.ts
    symbol: HostConformanceRig
---
The first case checks the welcome installation against the given profile and expects an empty inventory. Limits and reserve are counted on that profile.