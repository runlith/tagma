---
id: 01a16499-365f-7552-ab53-e8f2b82eeedc
title: "Landing by line dependency: own lines next to others' land, dependent others' go with the author, a later arrival resolves a mutual refusal"
ord: 1
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a16495-f5ab-78e9-8089-7d7cd5e18238
  - kind: waits-on
    to: 01a1648e-e31e-7fe1-8c00-cc2960c5a414
---
Spec item 3 and its "Device": the commit slice follows line authorship instead of regions; landing itself takes others' lines without which its own do not build, with authors; on mutual refusal the later arrival lands; commit checks over the assembled tree decide; `whole` applies to a path; the refusal text has no "wait for the holder". The "Commits" and "Working in a Shared Checkout" texts and the `submit_work` and `taking` descriptions change to the new behaviour in the same change. Check: a system test of two sessions holding each other's lines.
