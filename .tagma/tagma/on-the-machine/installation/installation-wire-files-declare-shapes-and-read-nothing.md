---
id: 01a1a2bd-7f69-74ee-a3b8-389ba5bd249e
title: Installation wire files declare shapes and read nothing
ord: 85
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1a245-7a43-7a67-8046-6e8a2efb5b64",
    "status": "done"
  }
---
Review finding L7, IO in wire files. `contract/wire/junction.ts` `readActive` reads and parses `active.json` from disk. `contract/wire/layout.ts` `hostChannelIn` parses an environment variable as a `Channel` with an unchecked cast. Reads move to the owner of the record (`setup/active.ts`) and to the caller, and the env value is decoded by the channel schema.