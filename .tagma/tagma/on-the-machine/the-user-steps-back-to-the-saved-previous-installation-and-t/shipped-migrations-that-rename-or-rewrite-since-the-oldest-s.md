---
id: 01a1add2-65c1-79b1-a953-ee41da460928
title: Shipped migrations that rename or rewrite since the oldest standing installation carry back.sql
ord: 3
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a1ad3a-f940-7727-920c-1581a3d3b323
---
The cut for the `back.sql` rule began with `20261105164552_delegation_switcher`, so older shipped migrations that rename or rewrite still return nothing. The boundary is the oldest previous installation of the two people Tagma has: the weekly tester stands on the release before the newest published one. It is derived from the feed and the release tags so it moves with each release, and only migrations past it get a `back.sql`, per rule 0528876d.