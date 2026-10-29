---
id: 01a15fc4-6ad3-7906-9adb-b135d2fa04ca
title: Open plain file paths in feed messages without special markup
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15fc2-a815-70cb-8b91-ab4b4d9199c3",
    "status": "done"
  }
---
Recognize file paths in plain message text, including messages between agents, and open server-confirmed files with the existing FileOpener. Keep relative paths from the thread's place, line-and-column jumps, the path menu, read cancellation, and no links to inaccessible files; use the shared mechanism in the text and Markdown renderers.
