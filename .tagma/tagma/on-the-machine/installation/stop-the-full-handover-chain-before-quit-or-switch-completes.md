---
id: 01a1a257-39ab-795f-9f7c-8ae883a96331
title: Stop the full handover chain before quit or switch completes
ord: 66
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1a245-7a43-7a67-8046-6e8a2efb5b64",
    "status": "done"
  }
---
Make quit and installation switching cancel an admitted restart at its process lifecycle owner, including issued predecessors that may start a fallback after their successor dies. Prove the handover race through the real stopping door, preserve graceful normal shutdown, and report any limit imposed by issued code.