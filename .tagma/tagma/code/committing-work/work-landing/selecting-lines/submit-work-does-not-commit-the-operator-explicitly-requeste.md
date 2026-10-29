---
id: 01a1205b-9a90-7305-b395-3a419ad63e1f
title: submit_work does not commit the operator-explicitly-requested remainder without a line owner
ord: 4
tags: ["reflection"]
fields:
  {
    "actual": "The first call landed 240 files in 78f9c0e230 but left unattributed changes, including the inbox_wake migration. The call with paths=packages answered “nothing to commit — paths named no file this session holds”. commit_checkout is absent from tool_search. No passable submit_work road remains for the leftover operator's all-changes commit.",
    "command": "submit_work(paths: [\".\"], whole: true, taking: [seven executors]); then submit_work(paths: [\"packages\"], whole: true)",
    "expected": "The operator's explicit order to commit the whole tree lands unattributed changes too through the regular operation, with the same commit steps and gates, via attribution=nobody."
  }
---
