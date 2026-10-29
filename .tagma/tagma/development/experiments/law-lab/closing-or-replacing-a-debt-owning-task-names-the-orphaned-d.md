---
id: 01a1616b-4910-7544-9db1-a0f1008b6dcc
title: Closing or replacing a debt-owning task names the orphaned debt and how to hand it over in the reply
ord: 31
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1616b-66cc-7042-a6ce-6ff69a8cd0e6",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a1616b-2f1a-71a8-98f8-391bd2876ab4
---
`close_block`, `finish_block` and supersede of a task holding standing debt of an enforced rule pass silently; the debt stays owned by `ended`, and the only way to learn of it is the Rules screen. The act's reply must name the rule, the number of debt entries and the way to hand them over (`enforce_rule` with `owners`), without forbidding the act itself.
