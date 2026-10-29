---
id: 01a11ca5-7ddf-7f42-a891-bd61ed0d0e0a
title: "Hosted ports go away: reached, adopt via Transports, reaper and scheduler without hosted, TransportHistory, TransportCompaction and TransportResource on ACP"
ord: 12
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a11c9a-6edb-7ed8-b517-60af35a07ee2
---
What: [[35a07ee2]], the `tools: tagma` profile, history, compaction, restart and "What is removed": `ThreadHostedRuns`, `HostedRunLedger`, `HostedAwaiting`, `HostedCalls`, the `hosted` admit kind, `threads/harness/hosted.ts`, the `standing('acp')` scan, the link heartbeat fiber; resource `watch`. The part about `TransportResource`, the heartbeat fiber, the resource scan and moving `session.heartbeatAt/ownerId` into the indexed `ThreadOwner.id` lease with a migration is split into [[89c8a6da]] and runs in parallel. Here remain `reached`, history, compaction and removing the Hosted ports; the contracts' declarations and their consumers move together. Real `TransportRuns` are already connected in [[6168d447]], so this cut can run before its end-to-end acceptance completes; both tasks keep their own checks.

How to prove: the [[35a07ee2]] criteria about `tools: tagma`, restart and compaction; rg over the "What is removed" list.
