---
id: 01a0de23-8a58-78b5-9dac-428efbccc7f3
title: A command's answer says the paths it moved outside `produces` are recorded against nobody, and the doctrine sends a script's checkout writes through `produces`
ord: 65
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0de17-2c92-7c71-ab40-546a507a975f",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0d5b9-9b63-7a8b-9893-9140f1f839ad
sources:
  - kind: file
    ref: apps/tagma/server/src/doctrine/sections/typedTools.ts
  - kind: file
    ref: packages/agent-tools/src/bash
  - kind: file
    ref: packages/agent-tools/src/ShellRun.ts
---
Reflection [[f1f839ad]]: a `perl -0pi` loop over 40 files ran, its answer listed the moved files and nothing else, and only `submit_work` said later that the session held none of them — after HEAD was already broken. `produces` (task 913424dc, since 2026-09-13) is the road that makes such writes the session's own, but neither the answer nor the doctrine's script clause names it.

- The bash answer, where moved paths were filed as observations, says they are recorded against nobody, so `submit_work` lands none of them, and that a command whose writes should land declares them in `produces`.
- `typedTools.ts`: the script clause says a script's checkout writes are declared in `produces`.

Done when the settlement carries which moved paths stayed observations and the answer and the doctrine say the above.