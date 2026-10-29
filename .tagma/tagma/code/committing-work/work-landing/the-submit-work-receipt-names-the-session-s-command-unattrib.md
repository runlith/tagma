---
id: 01a131c8-d6c4-7d39-ab72-d46664f77aa0
title: The submit_work receipt names the session's command unattributed paths left out of the commit
ord: 15
tags: ["task"]
fields:
  {
    "holder": "tagma:01a131b4-60a6-7748-8b38-6841f92539ff",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a131c1-64eb-7b2c-abed-216eecbbc553
---
Reflection [[ecbbc553|on the half-landed git-mv]]: the session's command moved a directory (git mv), additions attributed to it by mtime, deletions gone to overlap → command_unattributed. submit_work without paths landed only the attributed half and said nothing about the remaining 147 unattributed paths in the same checkout; the session reported a clean tree, staged deletions lay in the index for a day.

Do: the landing receipt (landed and nothing) names paths from the selected sessions' command_unattributed (its own + taking) in this checkout that did not enter the commit and still stand changed against HEAD — with the road "name them in paths". The [[4c940a20|explicit paths for unattributed paths]] rule does not change: they still do not land automatically.

Where: change-record/prepared (carriers.heldPaths already collects selected sessions' unattributed paths; count the unentered beside it and filter the standing ones), PreparedOutcome → landing SubmitReceipt → voice.

Proof: a system test in commandLanding.stest.ts — overlap deletion of a tracked file + an attributed edit of the same session; submit without paths lands the attributed one and names the deleted path in unattributed; a repeated submit with paths lands the deletion, status clean.
