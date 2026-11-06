---
id: 01a1231f-7e8c-732b-a95d-8b0e07e5776a
title: "The pinned view is a thread fact: pin_view and unpin_view operations, a set in the thread snapshot, a region above the ribbon"
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1231f-9495-7931-933f-c8dacb04ecf1",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a1227f-7522-78e3-a658-79b7a0a16218
---
`pin_view`/`unpin_view` (thread, plugin, view, resource key) at the `threads` owner, open to the operator and the outside caller; the set arrives in the thread snapshot; the region above the ribbon is capped at a third of the height (`PinnedRegion.svelte`). The manifest `pins` point schema lives in the `threads` wire next to `pin_view` — connecting it to the `plugins` module and mounting the view itself on the MCP Apps bridge are done by the next tasks; here the region draws the pinned address and a place for the view.

Done when an integration test shows: an outside caller pins and unpins a view, re-pinning the same address does not duplicate, the set survives thread re-reading and arrives in the snapshot; deleting the project drops its pinned views.
