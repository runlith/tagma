---
id: 01a1a911-23b7-72fa-a243-6915b0926cfa
title: "A command release never runs the retired-generation reclaim: below the volume reserve it only wakes the shelf's background pass"
ord: 16
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a16bec-bf6a-75a2-be08-e40a4d94aa4b
sources:
  - kind: file
    ref: packages/execution-host/src/RecordShelf.ts
  - kind: file
    ref: packages/execution-host/src/registry/ExecutionRegistry.ts
---
Reclaiming one retired generation deletes the files and store rows of every execution it held, and takes minutes on a large history: one pass measured eight minutes. Run inside a release's shelf section, it held every other release of the host; a read or byte subscription of an ended command waits for that command's release, so those reads stood unanswered too, and on the server they held every `walk`-lane request slot of the wire, which starved inventory, listing and state requests of every project for the whole pass.

A release below the reserve therefore only wakes the pass and goes on; one pass runs at a time, and a pass that left the volume still short is not woken again until a reading shows the volume above its reserve. The release's own kept-output decision stays in the release, judged on the free space measured now: the pass running beside it can only raise free space for later releases.
