---
id: 01a1a2da-db0b-796b-a782-2f2ff861daa5
title: The checkout-builds runner is Effect-native and shares its record, log, command and restart mechanisms with the release runner
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1a245-7a43-7a67-8046-6e8a2efb5b64",
    "status": "in_work"
  }
---
Finding L2. No `run*` inside the service, no swallowed failure (each is a typed outcome or a logged best effort), Clock for time. The mechanisms both runners had are one implementation each: the kept JSON record (`platform/durable/keptRecord.ts`), the log write and tail (`platform/durable/logFile.ts`), running a command into the log with group termination (`platform/command.ts`, shared with placement and clone), the restart ask and the busy refusals (`installation/next/asking.ts`). `update.json` becomes a declared wire format (`installation/contract/wire/update.ts`) and is frozen with the 0.2 reader.