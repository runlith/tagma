---
id: 01a15115-7a5d-7af6-b8c1-590a65e65d3e
title: Connecting or disconnecting an account mid-run reaches the thread as a sub-agent-team line
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a150e6-76e7-7229-9c5f-35281cc64a6a",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a150e6-3b12-7a97-bfba-b23581d1cf66
  - kind: implements
    to: 01a150e5-fbff-700e-98b9-7039ac67b9de
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/turns/teamRule.ts
---
`teamRule` counts the fingerprint over settings layers only and does not see accounts connecting and disconnecting: provider lines appear and vanish in the description only from the next run, and a working thread keeps choosing by the old list. The cause in [[46e7ebcd]] — reading accounts on every step was deemed expensive. Fix at the owner: the account owner yields a cheap revision of the connected-provider set, the rule fingerprint includes it, and team resolution still reads accounts only on fingerprint shift. Update [[46e7ebcd]]. Proof: a test — connecting a provider between steps yields a line with its lines in the list.
