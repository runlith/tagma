---
id: 01a18a4b-f1a5-7cef-a127-43a83a89332c
title: Describe deferred fallback reports in a birth without messaging
ord: 21
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18a3d-4587-782b-8f41-83c488f67465",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a151e9-a9cc-7199-8857-1c552e5941b2
---
Correct the tool-less birth note to describe the existing work-completion fallback instead of promising the opening run's last message. Such a child can finish after its own background work or delegated report; its note must not teach a dummy wait. Runtime delivery is already covered by the deferred-report contracts, and model-facing wording takes no string assertions.