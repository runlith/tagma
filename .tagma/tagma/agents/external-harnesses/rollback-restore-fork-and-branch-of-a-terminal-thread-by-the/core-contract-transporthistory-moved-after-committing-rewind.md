---
id: 01a17321-2895-71ed-b498-9b2b8dfdd83b
title: "Core contract: `TransportHistory.moved` after committing rewind, restore, and stop with withdraw"
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17326-ef22-7865-b9a0-10ff558b36ba",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a17321-2895-71ed-b498-9b2711b4f93a
---
The core calls `moved(threadId)` after committing every act that changes the journal's composition. The act does not wait on it, and its failure does not cancel the act. On ACP it does nothing.
