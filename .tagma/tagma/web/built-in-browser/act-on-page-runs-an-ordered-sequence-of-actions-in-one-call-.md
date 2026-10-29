---
id: 01a184cf-1914-7ca3-86c0-c592153dcc41
title: act_on_page runs an ordered sequence of actions in one call, stopping at the first refusal
ord: 14
tags: ["task"]
fields:
  {
    "holder": "tagma:01a184cf-76ca-7d83-87c6-2f78805e2612",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a14c08-1c3f-7bde-a2e3-04644096201b
---
Every browser action is one model step, so a form of eight fields costs eight round trips. Sending several `act_on_page` calls in one step does not help: the native loop runs a step's calls concurrently (`packages/agent/src/agent/turn/tools.ts`, `Effect.all` unbounded) and browser operations declare no claims, so their arrival order at the page queue is not guaranteed — read from code, not measured — and a form whose fields depend on each other breaks. `act_on_page` takes a list of steps instead of one action, runs them in order on the page queue, stops at the first refusal or at an opened dialog, and answers which steps ran and which step stopped it with its refusal. This replaces a separate `fill_form`: it covers forms, sign-ins and any short chain with the existing actions. Feature 4096201b and the feed card change with it.