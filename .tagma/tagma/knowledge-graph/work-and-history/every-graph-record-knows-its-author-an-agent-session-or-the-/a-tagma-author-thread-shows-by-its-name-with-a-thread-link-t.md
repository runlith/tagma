---
id: 01a160c8-dbd5-7002-9779-1932e3d23828
title: A Tagma author thread shows by its name with a thread link, the id stays only for foreign-CLI sessions
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a160a9-eff1-7eb7-8981-297bf6af99a5",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/WriterBadge.svelte
---
Operator: in the block-page Diff strip the author shows as a chip with a bot icon and a session-id tail that copies the id on click. When the author is a Tagma thread, show its name (as in the thread title) as a link to the thread with a Tagma agent icon; copying the id there is pointless. The id stays only for foreign-CLI sessions, which have no name.

Do it in the single author component (`WriterBadge`) and move everyone who shows an author session their own way onto it: the graph journal author (`journal/Author.svelte`) and the rule-page refusal line ("by an agent").
