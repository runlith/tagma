---
id: 01a173ab-98bb-7d4a-bc2f-bc529052e8e8
title: "Forking a thread with a running turn on a `history: session` transport takes the conversation up to that turn"
ord: 10
tags: ["task"]
fields:
  {
    "holder": "tagma:01a173ab-d37e-7304-93d2-b7fa37de7024",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a17321-2895-71ed-b498-9b2711b4f93a
---
Spec [[11b4f93a]] requires: forking a thread with a running turn takes the conversation up to that turn, and the running turn stays with the source. Today the core on `branch_thread` without `before` (`forkCut('all')`) copies the running run into the child too, while the vendor copy is taken from the session the CLI is writing at that moment. The core decides on the declared `history: 'session'` capability — the same for terminal and ACP. Native is unchanged.
