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
Terminal operations currently force a thread's home project before looking up an execution, making a known foreign-project execution unreachable. Route addressed terminal operations by the execution owner's recorded project through invocation, keep caller identity and custody checks unchanged, and prove read/stop and operation recovery through the real native tool door.