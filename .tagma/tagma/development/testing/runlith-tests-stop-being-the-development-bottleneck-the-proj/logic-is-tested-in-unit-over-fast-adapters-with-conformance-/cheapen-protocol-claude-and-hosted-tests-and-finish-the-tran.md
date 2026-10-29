---
id: 01a16dee-093a-7b36-9a0a-24458984bab7
title: Cheapen protocol, Claude and hosted tests and finish the transport's unrecorded activity
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16ded-9161-7df7-9c19-57611b71ea05",
    "status": "done"
  }
---
Protocol/Claude/hosted and external-harnesses dissection: 89 source files, 7 handed to x-sqlite (35.2 s CPU). Own baseline — 239.2 s; sum of cold separate runs of changed files after, including the new regression — 52.5 s; 55 unchanged remeasured never (their baseline — 1.0 s). Roll-up reference is 53.5 s (about 4.5x), the comparable shared after stays with the quiet measurement. 9 files deleted, 7 merged, 8 moved to guarded unit; reasons and checks in x10/x-transport-b.tsv. Retirement ACP and terminal activity fixes landed with authorship preserved; [[86c58c46|activity task]] done. Changed files green separately on seeds 1–3, server typecheck with prerequisites green. The independent review's single risk reproduced in the owner pipeline and fixed.
