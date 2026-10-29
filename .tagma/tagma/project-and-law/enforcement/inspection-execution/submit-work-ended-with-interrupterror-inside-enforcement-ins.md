---
id: 01a13f84-313b-7973-8aef-d24d71e84655
title: submit_work ended with InterruptError inside enforcement instead of a commit or a refusal
ord: 11
tags: ["reflection"]
fields:
  {
    "actual": "Background call failed: InterruptError: All fibers interrupted without error; stack enforcement.judgement:592 → submit_work.before → submitWork.commit. No commit or contract refusal was returned, no recovery exists.",
    "command": "submit_work({\"checkout\":\"/opt/workspaces/runlith\",\"subject\":\"Fix landing task subjects and retained-path refusals\",\"paths\":[\"apps/tagma/server/src/landing/land/message.ts\",\"apps/tagma/server/src/landing/land/message.test.ts\",\"apps/tagma/server/src/landing/voice.ts\",\"apps/tagma/server/src/landing/contract/wire/receipt.ts\",\"apps/tagma/server/src/change-record/prepared/carriers.ts\",\"apps/tagma/server/src/change-record/prepared/change.ts\",\"apps/tagma/server/src/change-record/prepared/tree.ts\",\"apps/tagma/server/src/composition/testing/change-record/retainedLanding.stest.ts\"],\"background\":true})",
    "expected": "The operation returns a commit or a typed refusal with cause and recovery; a new call after resolved landing-busy judges the changed delivery."
  }
---
Call call_da1ab8de2a144acfbb5707355d51094f, run 01a13f72-a682-756f-994a-c6f49aa501df, setup 20261014T224429043Z. The previous call after a long wait returned landing-busy (HEAD moved on each of three attempts); after it two review findings and a test were updated, two final contract files passed (11 assertions), HEAD did not move during their 15 s run. This is a failed execution, not a law-violated refusal and not permission to bypass hooks.
