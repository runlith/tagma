---
id: 01a14c37-8e1f-7f8f-87f5-b7ba3b49f22f
title: The browser.openLinks description must match which links go to the browser and with which modifier
ord: 1
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a14c08-1c3f-7bde-a2e3-046371947f5b
---
The description promises links from "threads, documents, terminals and the editor" and opening in the system browser with ⌘. There are no editor links; in the terminal Shift leads to the system browser (`executions/terminal/Pane.svelte.ts`). Build the editor and the modifier, or fix the text.
