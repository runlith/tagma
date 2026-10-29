---
id: 01a14c37-8e4b-71b4-9b81-946aafba7054
title: read_settings must show the agent which keys it must not write
ord: 1
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a14c05-9e8f-7c75-a633-b2a10e594302
sources:
  - kind: file
    ref: apps/tagma/server/src/settings/resolution.ts
  - kind: file
    ref: apps/tagma/server/src/settings/voice.ts
---
The operation promises "agent writability", but the native-answer row (`settingsEntryLine`) does not print the operatorOnly mark, and the row's wire schema does not declare it; the write check itself works. The promised channel-defaults layer is missing: `resolveSetting` starts from the key fallback — build the promise or remove it.
