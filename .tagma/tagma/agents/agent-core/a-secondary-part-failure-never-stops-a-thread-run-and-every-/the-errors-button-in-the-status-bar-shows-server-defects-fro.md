---
id: 01a15554-aa65-70b0-a968-261f8c7ef2df
title: "The Errors button in the status bar shows server defects from activity: a live feed, agent reads, and server-side Clear"
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15555-5e20-7b6d-bc3a-f76be71aec0c",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a1554e-6da7-7ec4-8ead-4daf77e3146e
---
Part 4 of the spec. The server `activity` module (`apps/tagma/server/src/activity`) serves `ActivityFaults` from `@runlith/activity/store/faults` as a live feed to the window and as `read_faults` (agent) and `clear_faults` (operator) operations. `FaultsButton` shows them in one list with window failures: place, message, ×N, age, thread link, Copy with the stack; Clear removes server and window ones. A run-failure card copies `diagnostics.stack`. Proof — a feed test over an `ActivityFaults` double and app typecheck.
