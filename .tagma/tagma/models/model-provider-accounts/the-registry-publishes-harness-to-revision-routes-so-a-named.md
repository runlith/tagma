---
id: 01a18db2-1b97-7744-9d87-2ff7bdbe083e
title: The registry publishes harness-to-revision routes so a named hook imports no unrelated provider part
ord: 27
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/cli/installedHarness.ts
  - kind: file
    ref: apps/tagma/server/src/providers/harnessIndex.ts
---
Importing every plugin's provider part to discover a harness on each hook would let an unrelated broken part stop that hook from running. Each registry reload instead publishes the harness declarations of the plugin parts that loaded as a file projection, `<data>/provider-harnesses.json`, each row naming its plugin and revision directory. The hook process imports a row's revision only while that directory stands, so an uninstall or a retired revision invalidates an older route; a revision the session recorded in `TAGMA_ADAPTER_PACKAGE` is imported first.
