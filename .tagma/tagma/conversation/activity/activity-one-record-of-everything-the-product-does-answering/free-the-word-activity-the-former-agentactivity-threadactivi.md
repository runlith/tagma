---
id: 01a111c0-a6a5-7a73-8f4d-f9f1bfec14bd
title: "Free the word activity: the former AgentActivity, ThreadActivityRecord, ThreadListRow.activity and their kin become phase"
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a111c1-a039-7b1e-a866-7f188bc4db05",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a111ad-1d14-7079-ad84-43a6a5fd6a10
---
Preparation for step 2 of the spec: the word `activity` keeps one meaning. Rename by meaning (the phase of an agent or thread) in every layer — agent, server, wire, app; mechanically, with no change in behaviour; data in the database and on the wire is renamed by a migration, with no old form kept. Done when `rg -w activity` outside the future mechanism is empty and typecheck and the tests of the affected packages are green.
