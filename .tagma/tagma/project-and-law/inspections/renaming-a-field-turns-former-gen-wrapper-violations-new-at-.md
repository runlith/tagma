---
id: 01a13bab-c550-7ca2-954a-2be2bab98648
title: Renaming a field turns former gen-wrapper violations new at submit_work
ord: 53
tags: ["reflection"]
fields:
  {
    "actual": "submit_work refused law-violated on 14 gen-wrapper sites of existing functions and one catch; the fields renamed, but the gen-wrapper shapes themselves stood at HEAD before the task.",
    "command": "submit_work({\"subject\":\"Align GateRefusal reason with its wire contract\",\"checkout\":\"/opt/workspaces/runlith\"})",
    "expected": "Former gen-wrapper violations in unchanged functions stay former; renaming the refusalReason→reason access never makes a new violation of the function's shape."
  }
---
Filed from project `runlith`.

Observed in task a6187cbc: 104 files checked as pure text rename of the field from HEAD to working. Among the named gate paths admittedGit.ts, external-harnesses/assembly.ts, bodyFile.ts, writeThrough.ts, proposals/listing.ts, invocation/perform.ts, plugins/installs.ts, providers/accounts/harnessAccounts.ts, harnessStored.ts and release-channel/runner.ts changed only refusalReason→reason. The gate counted existing gen-wrapper violations as the agent's own new lines. In composition/http/operations.ts the existing catch was kept, only the refusal's projection onto the refusalSchema encoding changed; swallowed-failures also declared the site new.
