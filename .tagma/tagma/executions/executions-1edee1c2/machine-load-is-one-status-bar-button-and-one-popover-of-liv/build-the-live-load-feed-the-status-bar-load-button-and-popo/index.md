---
id: 01a0ef65-4dc3-7616-82bc-5c066988b4e8
title: Build the live load feed, the status-bar Load button and popover, the thread badge, and remove the Processes section
ord: 2
tags: ["task"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: implements
    to: 01a0ef62-6fc1-7769-9107-f9e349826c62
---
Deliver [[49826c62]] §4 in its §9 order, steps 2–5: the load feed as a live group of the server's `executions` contract (snapshot then changed rows, shared composition per project, interest declaration for the short step), the app's feed repository, the button and popover in `app/chrome` with `Pace` moved into the header, the thread badge, and the removal of the Processes section, the old badge popover and `PaceControl`. It consumes the measurement fields of [[b5f88bb9]] as they land; until then it draws today's readings, labelled. Done when §7 of the decision holds and §8's claims are retired or rewritten and verified.