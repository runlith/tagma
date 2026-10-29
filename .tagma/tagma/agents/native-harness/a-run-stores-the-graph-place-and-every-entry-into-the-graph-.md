---
id: 01a151eb-5191-7395-86f7-ba24806e9df0
title: A run stores the graph place, and every entry into the graph opens the current copy
ord: 24
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a151de-5a4c-7c77-b800-6ae0a49da04b
sources:
  - kind: symbol
    ref: apps/tagma/server/src/invocation/nativeDoor.ts
    symbol: nativeTools
  - kind: symbol
    ref: apps/tagma/server/src/invocation/nativePlace.ts
    symbol: nativePlacement
  - kind: symbol
    ref: apps/tagma/server/src/native-harness/turns/context.ts
    symbol: threadContext
---
A storage move closes the old mirror while a run may be waiting on a model answer. So the run context stores the opening effect by project and checkout, not a ready connection: step instructions, touch briefs, digest, and native calls get the current graph at read time. Native-call services are assembled together with that copy. After an approval wait the call reopens the approved place's graph, keeping the subject and the prepared value; a ready call context is not cached for the whole run. The checkout root stays the place's metadata and does not change on a storage move.
