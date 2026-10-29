---
id: 01a0c3c3-7916-729c-a148-d546b2793096
title: Implement per-call control, realtime activity and bounded admission cost
ord: 1
tags: ["task"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: implements
    to: 01a0c3c3-5cae-7cce-af4b-00c64ef45bc7
---
Implement the accepted call lifecycle across the agent runtime, Tagma delivery and websocket projection, transcript and sidebar controls. Preserve individual cancellation, operator/agent background conversion and late results without stopping the run. The native implementation and admission optimization are delivered through 6b963103a9 and the preceding integration commits, with current invariants under [[e0ee2866]]. The child tasks remain necessary for the universal contract. The running installation was not restarted, and production end-to-end latency after deployment remains unmeasured.