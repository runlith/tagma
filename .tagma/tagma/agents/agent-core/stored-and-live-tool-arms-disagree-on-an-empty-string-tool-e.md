---
id: 01a0ca7a-41e3-7f4d-b474-8fd307a05be0
title: Stored and live tool arms disagree on an empty-string tool error
ord: 168
tags: ["task"]
fields:
  {
    "status": "closed"
  }
---
The stored tool arm keeps toolError only when truthy (packages/chat-ui/src/entries.ts:520), while the live tool arm keeps errorText whenever it is not undefined (:413). An empty-string error is dropped on one path and carried on the other. Decide which guard is intended and make both arms agree; evidence is the two lines, and no test covers the empty string either way.