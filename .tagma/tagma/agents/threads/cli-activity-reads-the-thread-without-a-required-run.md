---
id: 01a12c87-15f4-72f5-b0d1-58eba4a27711
title: CLI activity reads the thread without a required --run
ord: 43
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12c86-94f7-747f-9d9d-8b4f062231df",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a12baf-7b7e-7225-a4ac-c4f0469361df
---
Fix the activity verb's JSON payload in threads/cli/threadVerbs.ts: without --run the server receives a whole-activity read. Check — a CLI call with no filter and with a run filter on a separate trial server.
