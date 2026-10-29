---
id: 01a0efc6-07bf-7af1-b9ec-47adb98f9e16
title: Live groups and their socket handlers are declared in each module's manifest and collected by composition — the typed FEEDS tuple and socketBinding's hand map leave
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0ef66-2a57-7743-a071-ea8d175e31bd",
    "status": "done"
  }
---
Rule [[edea5454]]: `composition/rpc.ts` builds `LiveRpc` from a hand-written `FEEDS` tuple, and `composition/socketBinding.ts` maps every live verb to its module's channel by hand. `COLLECTED_FEEDS` already comes from manifests, but it is untyped because `composition/modules.ts` types `MODULES` as `readonly Manifest[]`.

Target:
- `MODULES` keeps its literal tuple type, and `manifest()` keeps `feeds` literal. `LiveRpc` becomes `RpcOfFeed<(typeof MODULES)[number]['feeds'][number]>`.
- A manifest member names the module's channel handlers over the services they read. Composition merges them into `liveHandlers`, and the `SocketDoor` union is derived from them.
- Every live group moves onto this road, including `load.subscribe`, `load.interest` and `space.scan`, which were added by [[6988b4e8]] onto the hand lists while this task was open.

Done when both hand lists are gone, the app's `Live` client is still typed per verb, and the doorParity and socket suites pass. Built now by load-ui, together with [[6988b4e8]]; nothing is left on the hand lists.