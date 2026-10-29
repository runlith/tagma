---
id: 01a13f7e-a3b5-77fe-97c9-451fce36324d
title: A small landing and check_law stall for minutes without naming the current step
ord: 1
tags: ["reflection"]
fields:
  {
    "actual": "After more than two minutes submit_work was still running; wait_call with a 60 s budget returned running/words:null. The preceding check_law over these seven paths and one d81b1676 took more than three minutes, then answered no violation, the rule itself ran in 0.0 s. The cause of the delay was not measured; the calls were not repeated.",
    "command": "submit_work({\"checkout\":\"/opt/workspaces/runlith\",\"subject\":\"Fix landing task subjects and retained-path refusals\",\"paths\":[\"apps/tagma/server/src/landing/land/message.ts\",\"apps/tagma/server/src/landing/land/message.test.ts\",\"apps/tagma/server/src/landing/voice.ts\",\"apps/tagma/server/src/change-record/prepared/carriers.ts\",\"apps/tagma/server/src/change-record/prepared/change.ts\",\"apps/tagma/server/src/change-record/prepared/tree.ts\",\"apps/tagma/server/src/composition/testing/change-record/commandLanding.stest.ts\"],\"background\":true})",
    "expected": "Landing seven small files returns a commit or an explicit refusal; long work names the step it is on."
  }
---
The calls of run 01a13f72-a682-756f-994a-c6f49aa501df: submit_work call_129ac73552a4237b7b67ee2c0628e65, check_law call_be64c232c4f418e3694642df638fb. This is a latency observation of the current setup under parallel work; it does not prove the return of the already-fixed large-payload read from reflection 55abc971.
