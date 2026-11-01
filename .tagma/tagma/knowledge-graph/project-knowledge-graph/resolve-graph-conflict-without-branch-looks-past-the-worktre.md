---
id: 01a197e9-a776-771a-92b0-97e888134393
title: resolve_graph_conflict without branch looks past the worktree the calling thread stands in
ord: 269
tags: ["reflection"]
fields:
  {
    "actual": "refused[no-merge] \"no merge stands open in this checkout\"; the same call with branch \"cpu-event-projection\" resolved both files at once",
    "command": "resolve_graph_conflict {} from a thread standing in worktree cpu-event-projection with a git merge open there and two .tagma conflicts",
    "expected": "Resolve the open merge of the checkout the calling thread stands in, as other checkout-scoped acts default to it"
  }
---
Filed from project `tagma`. Received by a server up since 2026-11-01T04:35:00.962Z, from b555dcaa0.

The refusal names no checkout and its unblock ("read the checkout status") does not point at the `branch` input, so the way out had to be guessed. Cost: one wasted call.