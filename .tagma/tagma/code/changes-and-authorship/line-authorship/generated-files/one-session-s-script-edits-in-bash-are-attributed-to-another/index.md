---
id: 01a117bc-7b6e-7bc9-9d76-d53ac0191192
title: One session's script edits in bash are attributed to another session, and submit_work will not take them even with whole
ord: 3
tags: ["reflection"]
fields:
  {
    "actual": "read_changes attributes the lines to session s6-client (\"whose shorter command was writing\"); submit_work answers \"paths named no file this session holds\", with whole also nothing. threadList.ts went into HEAD referencing uncommitted types, and HEAD does not build until the other session commits \"its\" lines",
    "command": "bash: python3 edits 4 server files (threads/contract/wire/list.ts and others), then submit_work paths=[those files] (and again with whole: true)",
    "expected": "Lines written by this session's command belong to this session, and submit_work commits them"
  }
---
Filed from project `runlith`.

Session: 01a11742-4faf-72c4-808d-229c880821a9, run 01a117b5…; files: summary.ts, threads/contract/wire/list.ts, threads/contract/service/parts.ts, composition/serving.ts. Attribution by "the short command that lived at the moment of writing" gave the write to the neighbour, though this session's process wrote it.
