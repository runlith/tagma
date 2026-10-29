---
id: 01a12792-0904-761c-aca9-99b5f5b5929c
title: "External harnesses in place: terminal-CLI hooks and ACP get each path's project law and line accounting"
ord: 9
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12792-377a-74d7-a5cf-973358ef1f83",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a126b3-84d8-7b0e-a605-99311013e071
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/assembly.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/guidance.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/hooks/door.ts
---
The spec's "External harnesses" section. Rests on the closed place [[37d7c9ad|place tasks]], law [[30815684|law tasks]] (`ThreadPlaces`, per-place snapshot), and line-accounting [[ada88e6f|accounting task]] tasks (`record_write` already writes with the holder's home).

Do: terminal-CLI hooks (`external-harnesses/hooks/door.ts`) call `touch_path` and `record_write` with each path's place, not `CurrentProject`; hook guidance (`external-harnesses/guidance.ts`) and ACP tools get the place's law via the same per-place snapshot (`external-harnesses/assembly.ts` currently resolves orientation and law from the home). `record_write` stays a post-write message — the guarantee boundary is the same as in the operation's contract.

Done: integration test — a terminal hook writing a file in checkout B places the line in checkout B with thread A's home and brings rule B into guidance; an ACP thread gets orientation B on its first act in B.
