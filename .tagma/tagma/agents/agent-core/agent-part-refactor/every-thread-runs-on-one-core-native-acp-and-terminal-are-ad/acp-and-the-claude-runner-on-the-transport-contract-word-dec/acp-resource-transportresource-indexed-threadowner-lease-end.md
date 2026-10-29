---
id: 01a11dfc-758b-758f-8139-135889c8a6da
title: "ACP resource: TransportResource, indexed ThreadOwner lease, end observation with no second heartbeat"
ord: 1
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a11c9a-6edb-7ed8-b517-60af35a07ee2
---
The carve-out from [[ed0d0e0a]]: connect `TransportResource.release/watch`, move `session.ownerId/heartbeatAt` into indexed adapter-lease columns owned by `ThreadOwner.id`, remove the connection heartbeat fiber and the `standing('acp')` scan. A process without a run is observed through the execution-host event, and after a restart only `adopt` raises a connection holding a run. Keep the one-hour idle policy and background-work accounting; check unresolved prompts on the resource owner's tick. The implementation includes the migration and the production driver, not just an available method. Boundary with [[6168d447]]: resource/lease here, launch, words, and `adopt` there; coordinate removing `depart` with recovery in the rig. Proof: release of a standing resource on archive/delete, process end with no active run, lease handover after a restart with no lost evidence, and pinpoint idle checks. [[a5a90bb8]] consumes the finished contract.
