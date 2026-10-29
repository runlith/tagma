---
id: 01a12310-3d85-7ead-bc27-876677af71a5
title: "Ribbon-entry keepAlive is decided by ToolKind: a live view holds past the scroll window within a 4-line budget, a static one unmounts"
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12310-6a01-7a9e-add6-7843a6012789",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a1227f-7522-78e3-a658-79b7a0a16218
---
The spec's “View and bridge” section → “Live and static views”; `EntryKinds.svelte.ts`, the budget — [[8d75d711]].

Done when the ribbon test shows: a tool-entry whose kind declared keepAlive stays mounted past the scroll window within the budget, the fifth pushes out the oldest, an entry without keepAlive unmounts when it leaves the window.
