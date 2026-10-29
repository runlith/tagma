---
id: 01a1798b-445d-79ab-ac8b-e05bda418206
title: submit_work with explicit paths appends every task the session holds to the commit subject, not the ones whose work the commit carries
ord: 48
tags: ["reflection"]
fields:
  {
    "actual": "Commit 58bb2a1812 came out with the subject “… (349f6c92, 436d2baf, 4a5cdf9d)”, although 436d2baf and 4a5cdf9d contributed nothing to this commit; the door's answer itself offered to finish_block all three with this commit",
    "command": "submit_work {checkout: \"/opt/workspaces/runlith\", paths: [\"packages/agent/src/thread/conformance/runLog/contextChanges.ts\"], subject: \"Hand the run to the successor only after the lost process has recorded its last step\"}",
    "expected": "The subject gets only the name of the task whose work the commit carries (349f6c92) — other held tasks are not named"
  }
---
The session held three tasks (claim_block) and committed their work separately by `paths`. The 436d2baf changes (`apps/tagma/server/scripts/*`, `tsconfig.json`, `package.json`) and 4a5cdf9d (`packages/testbed/src/watch.itest.ts`) stayed uncommitted; the door itself listed them as “still stand uncommitted”. Yet both tasks ended up in the commit subject. History now attributes the commit to tasks it does not touch; the only workaround is release before each commit and re-claim.
