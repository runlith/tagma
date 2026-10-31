---
id: 01a193f8-bf5a-75cb-a9b4-685426891350
title: Resolve addressed terminals in their owning project across caller homes
ord: 105
tags: ["task"]
fields:
  {
    "holder": "tagma:01a193f4-2d89-7f39-9676-f7ad37a0e926",
    "status": "in_work"
  }
edges:
  - kind: discovered-from
    to: 01a192d4-733a-7865-820c-9ab4a712d085
---
Terminal operations forced a thread's home project before looking up an execution. They now take the existing explicit project selector through invocation, retaining the home default and custody checks; terminal-list cursors retain their selected project. The native-door regression first returned terminal-unknown for a known foreign-project execution; after the fix it reads and stops that execution and recovers the stop receipt by key. Server typecheck, the operation-place catalog test and all 32 routing/terminal-tool tests passed; the changed routing file passed seeds 1, 2 and 3. No live launch or full suite was run.