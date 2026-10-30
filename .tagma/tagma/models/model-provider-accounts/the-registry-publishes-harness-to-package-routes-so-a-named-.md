---
id: 01a18db2-1b97-7744-9d87-2ff7bdbe083e
title: The registry publishes harness-to-package routes so a named hook imports no unrelated adapter
ord: 27
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/providers/adapters/harnessIndex.ts
  - kind: file
    ref: apps/tagma/server/src/composition/cli/installedHarness.ts
---
Loading adapter packages to discover a harness on each hook would make an unrelated broken package prevent that hook from running. Registry reload instead publishes the successfully loaded declarations as a file projection; the reader checks its package directory against the current enabled install before importing it, so removal or replacement invalidates an older route.