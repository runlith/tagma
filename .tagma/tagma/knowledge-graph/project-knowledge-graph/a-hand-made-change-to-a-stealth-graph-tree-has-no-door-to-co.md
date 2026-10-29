---
id: 01a18025-66e2-7072-93a5-4d5d5a331e06
title: "A hand-made change to a stealth graph tree has no door to commit it: sync_graph refuses not-a-team-tree and acts commit only their own paths"
ord: 226
tags: ["reflection"]
fields:
  {
    "actual": "sync_graph refuses not-a-team-tree (\"commits every act into it\"); acts commit only the paths they wrote, so 2310 tracked deletions under .archive stay uncommitted in the stealth git with no operation that lands them.",
    "command": "delete -rf <stealth tree of project tagma>/.archive (stray pre-redesign tree carried in by set_project_storage), then sync_graph project=tagma",
    "expected": "One act commits the removal of stray, non-block content from a stealth graph tree into Tagma's graph git, as sync_graph does for a team tree."
  }
---
Filed from project `tagma`.

The stray directory `.archive/2026-09-20/runlith` (12,877 files, the graph before the 2026-09-20 format redesign; 2,310 of them tracked) entered the stealth tree of project 5 when `set_project_storage` moved the tree on 2026-10-26: `treeContent` in `graph/storage/move.ts` carries every entry of the tree root except `.git` and workflows. Nothing reads it, but a later move to team would publish it into the code repository. Removing it by hand leaves the stealth git dirty with no door to commit; committing in the server's own git by hand is off-limits.