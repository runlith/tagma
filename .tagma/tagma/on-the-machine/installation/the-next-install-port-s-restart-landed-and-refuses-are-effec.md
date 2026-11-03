---
id: 01a1a2da-db6f-7b61-b034-b38b7f55dbe6
title: The next-install port's restart, landed and refuses are Effects with typed failures, filled without run*
ord: 94
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1a2ba-87df-748d-bc94-66317e1c6f98",
    "status": "done"
  }
---
Part of finding L7. `NextPlace.restart` fails with `RestartRefused`, `landed` with `InstallationFailure`, `refuses` answers a refusal text; `composition/server.ts` fills them from `succession` and the machine store without `Effect.runPromise`, and both runners consume them as Effects.