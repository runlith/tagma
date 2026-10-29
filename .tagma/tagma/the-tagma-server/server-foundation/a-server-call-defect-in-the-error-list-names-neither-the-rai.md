---
id: 01a155a6-09b6-71a7-80be-ea4045b94111
title: A server call defect in the error list names neither the raising call's thread nor its project
ord: 35
tags: ["reflection"]
fields:
  {
    "actual": "thread, run and project are null, a fault activity record with no parent and no call attributes; the thread had to be found by going through 207 threads via tagma op and reading serve.log",
    "command": "read_faults (the line 'an owner raised the refusal provider-not-installed …' from read_compaction_choices, 2026-10-19T19:00:50Z)",
    "expected": "The defect line carries the call's thread and project (threadId was in the input, project in the address), so it reproduces with one call"
  }
---
Filed from project `runlith`.

serve.log names only the operation (`operation: 'read_compaction_choices'`), activity.sqlite holds just a `fault` record with `{"place":"server call"}` and no parent. No `call` record for the HTTP call in activity, so read_thread_record by the activity address from read_faults answers "No activity". Going through all threads of project 5 with tagma op and reading serve.log did not reproduce the refusal: the guilty thread undetermined.
