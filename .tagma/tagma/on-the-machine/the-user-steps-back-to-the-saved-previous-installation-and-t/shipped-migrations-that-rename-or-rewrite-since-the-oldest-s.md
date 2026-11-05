---
id: 01a1add2-65c1-79b1-a953-ee41da460928
title: Shipped migrations that rename or rewrite since the oldest standing installation carry back.sql
ord: 3
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a1ad3a-f940-7727-920c-1581a3d3b323
---
The cut for the `back.sql` rule began with `20261105164552_delegation_switcher`, so older shipped migrations that rename or rewrite were never judged. The boundary is the oldest previous installation of the two people Tagma has: the weekly tester stands on the release before the newest published one. It is derived from the feed and the release tags so it moves with each release, and only migrations past it get a `back.sql`, per rule 0528876d.

Outcome: v0.2.1 and v0.2.2 both carry the machine chain through `20261102151500_thread_clock`, and the five machine migrations past it only add (two columns and an index, a table, two columns, a table with its index); no host migration moved, so none owed a `back.sql`. The commit gate's checkout is a separate clone that sees no release tags, so the derived window is held by the cut instead, which reads the feed and the tags at every release.