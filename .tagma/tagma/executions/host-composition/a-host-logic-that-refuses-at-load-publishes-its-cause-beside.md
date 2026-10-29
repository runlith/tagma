---
id: 01a188b6-cb43-7e1d-b220-cec9c8a4efca
title: A host logic that refuses at load publishes its cause beside its boot entry, and its holder keeps raising it
ord: 5
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a1419a-dac8-7d2a-ab40-006a008fb769
sources:
  - kind: file
    ref: packages/execution-host/src/main.ts
  - kind: symbol
    ref: packages/executions/src/protocol/boot.ts
    symbol: loadRefusalOf
---
- **Only typed load failures.** Every typed failure of the logic's `main` happens before it tells the holder it is ready; after ready only a defect ends it. So the record never says that a logic which served is not coming up, and a defect or a kill at load writes nothing.
- **Beside the boot entry.** The file is `loadRefusalOf` of the boot entry the logic was launched with, which is named by its bundle's digest: the logic cannot take the digest from its own manifest, since verifying that manifest may be what failed.
- **The holder keeps raising it.** A logic falling before ready with a non-empty table is raised again with pauses up to the longest; at that pause the holder also takes a fresh `bundle.next` carrying its `holder.entry`, or returns to the proven bundle when it may. Each raise renews the record and a transient cause recovers by it. A holder that stopped raising would leave a record placement had cleared unwritten again, and a held table with no road to a fix but killing the holder.
- **Its readers** are the successor's wait for its digest's logic ([[ce39be5f]]) and the predecessor's wait after Yield ([[11b2a755]]); each ends with the cause.
