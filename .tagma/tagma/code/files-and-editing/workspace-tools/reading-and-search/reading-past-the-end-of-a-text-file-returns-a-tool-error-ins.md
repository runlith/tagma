---
id: 01a130f8-446a-787a-9bfb-36c4588dd656
title: Reading past the end of a text file returns a tool error instead of an explicit EOF
ord: 2
tags: ["reflection"]
fields:
  {
    "actual": "In thread 01a130cf-f79d-7fcf-9df7-a34d31836cd5 the call is recorded as output-error: [read] error: Offset 260 is out of range for this file (247 lines).",
    "command": "read({\"path\":\"~/.tagma/tool-outputs/01a130cf-f79d-7fcf-9df7-a34d31836cd5/caf9d58d14d69528a33a92b6108f210d.txt\",\"offset\":260,\"limit\":90})",
    "expected": "A valid positive offset past the end of an existing text file answers with an empty window with an explicit EOF, the requested offset, and the exact line count; it does not substitute the window with the last lines."
  }
---
Filed from project `runlith`.

The refusal is deliberately produced in packages/agent-tools/src/read.ts:420–423 via ToolFailed; tools.itest.ts:298–299 pins the refusal even at offset=total+1. That is file-tool behavior, not a server crash. The observation proposes revisiting the EOF contract, not hiding access or read errors, and not changing the requested window.
