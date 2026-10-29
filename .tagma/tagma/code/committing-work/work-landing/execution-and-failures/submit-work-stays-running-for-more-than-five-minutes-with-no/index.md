---
id: 01a13f7b-945b-780c-9d60-b81126cef852
title: submit_work stays running for more than five minutes with no intermediate result
ord: 11
tags: ["reflection"]
fields:
  {
    "actual": "After 5 min 26 s read_calls shows only running submit_work; read_changes — judging 8 paths, although 6 were selected. check_law over the same six paths had completed cleanly before. No result and no current-step name; no repeat submit_work was started.",
    "command": "submit_work({checkout:'/opt/workspaces/runlith',subject:'Build thread placement from tagged Effect dependencies',paths:['apps/tagma/server/src/threads/birth/placement.ts','apps/tagma/server/src/threads/assembly.ts','apps/tagma/server/src/threads/testing/doubles.ts','apps/tagma/server/src/threads/birth/placement.test.ts','apps/tagma/server/src/composition/testing/threads/placement.itest.ts','apps/tagma/server/src/composition/testing/changesFeed.itest.ts'],whole:true,background:true})",
    "expected": "One call lands the six reviewed paths or returns an explicit refusal; long work shows the step it is executing."
  }
---
Call address: run 01a13f3c-6278-71d4-b1a4-0bb501ac0214, toolCallId call_a21f8e70bc904b6093359627b97a4b8aa. wait_call with a 60 s budget returned phase running, words null. The cause of the delay is not established; this is an observation of duration and missing interim diagnostics, not a claim of a lost commit.
