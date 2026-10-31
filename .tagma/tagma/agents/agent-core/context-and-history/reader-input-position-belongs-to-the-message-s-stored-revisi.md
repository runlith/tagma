---
id: 01a112b4-087d-7e25-8ac4-3d111f5f3a8c
title: Reader input position belongs to the message's stored revision and survives aside without re-reading the journal
ord: 3
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/transcript/foldServer.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/transcript/history.ts
  - kind: file
    ref: packages/agent/src/agent/AgentAside.ts
  - kind: file
    ref: packages/agent/src/agent/AgentSignal.ts
  - kind: file
    ref: packages/agent/src/thread/HistoryAttribution.ts
  - kind: file
    ref: packages/agent/src/thread/HistoryFold.ts
  - kind: file
    ref: packages/agent/src/thread/run/ThreadRunStarter.ts
---
The reader input position attaches at the fold of the event whose position is already determined, and is stored in the message metadata; a live steer receives it from the same accepted transition before becoming a model message. Aside holds that value together with the reader-input id: a later revision of the same entry changes the new message, but not the origin of the already-sent prefix. So title reads the position from its own input rather than resolving the id against the current journal; when the source reported no position, the entry leaves it unknown. Attribution stores the position apart from the content key: derived metadata must not change a reader message's identity under compaction or restore.
