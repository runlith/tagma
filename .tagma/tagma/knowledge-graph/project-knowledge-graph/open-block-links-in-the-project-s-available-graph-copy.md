---
id: 01a11b4f-ca65-7572-8983-d5132a89b0c7
title: Open block links in the project's available graph copy
ord: 9
tags: ["task"]
fields:
  {
    "holder": "tagma:01a11979-16fc-76b4-988c-85531ac4d6bc",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a11b4e-de8f-783c-9252-bd724f4f80f5
---
Link resolution must first read the selected graph copy, then look for missing names in the project's other checkouts, and return the address of the copy found. The feed uses this address; directly opening a missing block redirects there too. Verify isolation of ordinary reads and writes, main↔worktree search, current-copy priority, and opening in the browser.
