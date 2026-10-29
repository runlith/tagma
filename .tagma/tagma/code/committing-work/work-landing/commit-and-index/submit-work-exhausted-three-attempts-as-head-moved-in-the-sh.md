---
id: 01a13faf-c9de-7463-903e-efc19c749c6f
title: submit_work exhausted three attempts as HEAD moved in the shared checkout
ord: 5
tags: ["reflection"]
fields:
  {
    "actual": "refused[landing-busy]: the branch moved under each of 3 attempts; nothing was committed. unblock says to retry when the checkout calms down.",
    "command": "submit_work({checkout:\"/opt/workspaces/runlith\",subject:\"refactor(external-harnesses): scope reviewer processes and logs\",paths:[\"apps/tagma/server/src/external-harnesses/review/launch.ts\",\"apps/tagma/server/src/external-harnesses/review/launch.itest.ts\"],whole:true})",
    "expected": "One landing of ready lines in the shared checkout completes without coordinating commits with other sessions."
  }
---
The defect layer is concurrent change-record landing, not external-harnesses. The work passed check_law and an independent review; the refusal left two ready paths with the current session. Independent executors work in the shared checkout, and retrying after quiet is extra manual waiting during normal parallel work.
