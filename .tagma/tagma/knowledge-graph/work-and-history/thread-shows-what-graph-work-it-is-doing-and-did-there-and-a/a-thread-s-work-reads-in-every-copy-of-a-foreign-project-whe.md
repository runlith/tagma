---
id: 01a17453-a0d3-7cad-b015-79b5d92a1ebc
title: A thread's work reads in every copy of a foreign project where it worked, and the end commit shows with its subject
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17427-1ed3-76f8-be2f-9820d348eac7",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a17420-8175-7ae5-a28b-a3e7f9ebaf80
---
A thread's work in a foreign project is visible only in the last copy where the thread worked: `WorkPlaces` keeps one row per (thread, project) pair, and earlier worktrees of that project do not read. Spec [[f9ebaf80]] requires every copy the thread wrote into. The thread's place history in `threads` is needed (with migration by rule d81b1676), and the `HolderCopies` port returns every copy from it. Along the way the end commit in the Work tab shows the commit subject, like commit links in the feed (`CommitLinks`), not a bare hash. When the limits lift, fix [[80851ca1]].
