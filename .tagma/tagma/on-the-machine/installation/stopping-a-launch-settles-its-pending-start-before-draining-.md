---
id: 01a1a859-d933-7342-8347-f43f09ec32e4
title: Stopping a launch settles its pending start before draining the server
ord: 102
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1a814-ff9b-7d00-88c6-a374e602bb66",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/installation/process/launch.itest.ts
  - kind: file
    ref: apps/tagma/server/src/installation/process/launch.ts
  - kind: file
    ref: apps/tagma/server/src/installation/testing/launchServer.ts
---
Mac CI 41895800546 at dcd1721ea passed the in-flight-candidate/owner-death scenario in 1.48 s; CI 41905997495 after 6469ae850e hit its 180 s hang guard and left the initial launchServer child alive. The new graceful HTTP drain waits for /pending, whose connectLaunch.start promise waits for a launch answer. ServerLaunch.stop kills the candidate, but ended suppresses its Failed answer while stopping, so the server cannot finish draining and the owner cannot observe server exit. Commit `dd3f4e39d2` settles each admitted start once at Stop or cancellation, including asynchronous admission, while preserving physical exit and handoff accounting. The existing scenario now requires a real nonempty refusal and retains its graceful, deadline-free fixture. On [macOS CI 41912190926](https://github.com/runlith/tagma/actions/runs/41912190926), shard 5 at head `7713663d7343a0da044de8af9a427aac6829ab66` (containing the fix), all nine launch scenarios and the file verdict pass, the regression case completes in 757.64 ms, and no process-outlived violation remains. Package typecheck passed and independent review found no actionable finding.