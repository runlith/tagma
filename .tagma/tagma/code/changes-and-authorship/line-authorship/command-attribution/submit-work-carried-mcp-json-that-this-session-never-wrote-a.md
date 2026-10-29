---
id: 01a1517f-27e6-714f-9d3a-73902458b15a
title: submit_work carried .mcp.json that this session never wrote, attributed through a command window
ord: 19
tags: ["reflection"]
fields:
  {
    "actual": "Commit abf167c7f4 also carried .mcp.json (harness \"claude\" → \"claude-code\"), a change neither the edits nor the typecheck/demo build make; it was credited to this session",
    "command": "submit_work subject=\"Draw macOS window lights…\" (no paths) after bash `bun run typecheck && bun run build:demo` in apps/tagma/app",
    "expected": "The commit carries only the 6 files this session edited with file tools"
  }
---
Filed from project `runlith`.

Session 01a125fe-9260-7644-9a64-589c9bc19e19, runlith main checkout. The .mcp.json rewrite most likely came from another writer (the server or another session regenerating the MCP config) while my command ran; the change record attributed it to my command instead of naming it unattributed.