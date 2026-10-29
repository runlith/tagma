---
id: 01a11b89-4e03-7940-bb96-d4b661e530f3
title: "Two Tagma itests time out: the queued item after a failed wake is never read, and keep-warm pings past spendable=false"
ord: 179
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a11901-5360-733e-9ca2-9126863f579c
---
Found while checking 7751473 (the `AgentHarness` constructor from Layers). Whether the tests failed before is unclear: there is no baseline, both files long unrun, and the core change by behavior never changed — the collaboration-layer selection is checked, `DeclaredCollaboration` arrives non-null.

- `composition/testing/threads/requestObligation.itest.ts`, "an accepted inbox item never turns a journal failure during wake into success": `deliver` honestly answers Failure, but the queued item is never read — `settledRuns(recipient) === 1` never comes in 10 s.
- `native-harness/keepWarm/driver.itest.ts`, "the driver pings a lead whose child runs…": after `knobs.spendable = false` a fourth ping leaves, and the script fails with "made a call its script did not plan".

In both files the test agent lacked the `collaboration` grant: without it the agent has no `send_message`/`final_answer`, and the closing reminder never fires (`messaging: false`). In 7751473 the grant is added; after that the first requestObligation test passes.

Done when both tests pass through `bun test --parallel=1 ./<file>` or are deleted under rule 4f387de2 with a named cause.
