---
id: 01a12ada-427b-76d9-a121-ec35173a4fdc
title: The host line's full-run red thread tests pass whole
ord: 9
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a12735-55f2-75e0-95d7-53127c1b6811
---
Root-cause each of the 11 red full-run thread files, separate line changes from main, fix at the owner, and confirm with full file runs. The shared auth fixture is fixed once; execution-host, server executions, and parity stay with other performers. Verification: each assigned file fully green, no own typecheck diagnostics, changes landed.
