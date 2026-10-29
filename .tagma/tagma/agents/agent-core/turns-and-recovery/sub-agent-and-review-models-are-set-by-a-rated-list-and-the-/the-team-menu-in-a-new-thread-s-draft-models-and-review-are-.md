---
id: 01a1512b-cda7-7000-b4dd-66b0d7e15822
title: "The Team menu in a new thread's draft: models and review are chosen before the first send"
ord: 5
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16926-ff7f-7255-82e1-3def6e3a7a8f",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a150e6-3b13-7463-991d-5577e61d2614
  - kind: implements
    to: 01a150e5-fbff-700e-98b9-7039ac67b9de
---
In a draft's composer `ThreadViews.team` is null: there is no thread yet, and the menu shows only Solo | Team. `create_thread` takes no team copy, and `ThreadBirth.bear` carries delegation from the draft but not the model and review set. So the first turn goes on the project team. Needed: the draft holds the chosen `TeamLayer` (as it holds delegation), and birth passes it together with the thread — via a `create_thread` field or `set_thread_team` before the first turn, in the same order as the other birth entries. Proof: a birth test shows the thread's first turn reads the copy chosen in the draft.
