---
id: 01a0ef87-3c86-79c9-bd8d-cfc0560a23b2
title: CLI read_inspections returns no measured rules where the native door lists twelve
ord: 10
tags: ["reflection"]
fields:
  {
    "actual": "The CLI command run in /opt/workspaces/runlith returns \"measured\":[]; the native read_inspections(limit=1) in this same thread lists twelve enforced rules, including modules revision 58b5b9a37abd.",
    "command": "tagma op read_inspections --project 5 --json '{\"limit\":1}'",
    "expected": "The CLI operation and native read_inspections(limit=1) both list runlith's twelve enforced rules with their current revisions from /opt/workspaces/runlith/.tagma."
  }
---
Filed from project `runlith`.

The CLI also returned measured:[] with limit 19 and without --project 5. The successful CLI JSON is kept in this thread's inspections-current.json and inspections-live-all.json scratch records. Native output is kept as tool output 6a01b01aeacb253b85780969ff3c586. This kept the CLI read from supplying the revision enforce_rule required. On a 2026-10-11 recheck the divergence no longer reproduced: CLI and native pointed at one Tagma copy and showed the same 10 measured rules through shared measuredRules. That recheck confirms current read parity but does not explain the historical measured:[] answer and does not prove the original cause fixed; sources unchanged, no fixing commit.
