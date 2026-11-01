---
id: 01a196df-4c48-77b0-b3a3-cbae6544e0e7
title: A live cut's incarnation and run distinguish a reused sequence
ord: 19
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/agent/src/thread/run/ThreadLiveFeed.ts
  - kind: file
    ref: packages/agent/src/transcript/live.ts
  - kind: symbol
    ref: packages/agent/src/thread/ThreadPorts.ts
    symbol: ThreadFeed
---
A lane can disappear when its last run and watcher leave, so a later lane can reuse its sequence. The producer's incarnation and run identity let source readers distinguish that successor; the tagged in-process view does not change the snapshot wire view or itself certify a storage cut.