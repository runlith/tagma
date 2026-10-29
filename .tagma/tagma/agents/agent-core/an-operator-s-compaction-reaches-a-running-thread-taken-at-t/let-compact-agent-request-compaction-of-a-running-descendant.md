---
id: 01a0d007-1997-70ee-91de-f95f5e33e086
title: Let compact_agent request compaction of a running descendant with `at`, instead of refusing thread-running
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0d066-db22-7ae9-9a3b-7432792b826b",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0d007-194a-7976-97d6-11296ad506f4
  - kind: waits-on
    to: 01a0d007-1987-7572-9661-898cd2a7785c
---
Let a parent compact a running descendant by request ([[6ad506f4]] §10): `compact_agent` in `collaboration/CollaborationTools.ts` gains `at`, and `ThreadSpawnTree.compactChild` routes a running child through the verb [[d2a7785c]] answers instead of refusing `thread-running`. An idle child is compacted and waited for as today; a running one answers at once with the accepted request; a running one without `at` refuses naming the parameter.

Done when acceptance criterion 10 holds as a test and [[cab519cc]] is rewritten from the code. Task 6c796481's session also writes `ThreadSpawnTree.ts`; read `read_changes` on it first.
