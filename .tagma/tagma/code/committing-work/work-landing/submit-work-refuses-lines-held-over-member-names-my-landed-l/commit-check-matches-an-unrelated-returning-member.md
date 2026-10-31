---
id: 01a1910a-2ab6-7765-bccd-f82f71014c95
title: Commit check matches an unrelated returning member
ord: 1
tags: ["reflection"]
fields:
  {
    "actual": "Refused lines-held on ProgramUnit.returning in apps/tagma/server/src/platform/contract/service/units.ts:22; the declaration's holder confirmed the selected ACP files do not depend on it.",
    "command": "submit_work(subject: \"fix(external-harnesses): drain unsent acp launches\", tasks: [\"f480b831\"], taking: [\"attendance-race\"], paths: [ACP launch fence paths])",
    "expected": "Commit the selected ACP launch-fence files without requiring an unrelated peer declaration."
  }
---
Filed from project `tagma`. Received by a server up since 2026-10-30T23:02:50.633Z, from 65684db2.