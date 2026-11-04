---
id: 01a1a8e1-56ca-7e9b-874e-72e690c0f5cf
title: Add run budgets to definitions, the price step to model cards and the gate that forces the answer
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1a8e1-88f6-7c83-b46a-fe8dcfdcf289",
    "status": "in_work"
  }
edges:
  - kind: implements
    to: 01a1a889-59c9-7db6-bbee-b8fb1baf46ae
---
Build what spec 1baf46ae agrees: `ModelCapacity` price step declared by the Anthropic adapter for Haiku 5.5, the definition `budget` field, the native-harness runtime rule that guides at 70%, denies over-budget calls and forces `answer` or a tool-less final step, and `agentStepToolPolicy` following the card's tool-choice modes for `require`.