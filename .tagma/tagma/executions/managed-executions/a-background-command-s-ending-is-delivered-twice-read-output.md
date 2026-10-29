---
id: 01a130db-090e-7743-8c73-6d3c040f86fc
title: "A background command's ending is delivered twice: read_output with wait already returned exit 0, then a command-result notice arrives in the model history"
ord: 75
tags: ["reflection"]
fields:
  {
    "actual": "read_output returned ended/exit 0 at 16:02:06.912 (#1630); 139 ms later (16:02:07.051) the same result arrived as signal command-result (#1640) and entered the next model step's input as a user message — the same output tail repeated, ~1.4k tokens, plus a \"command-result · Unread\" line in the operator's feed.",
    "command": "bash {waitMs: 0} → read_output {execution: fe8bcc94-…:163, wait: 120} in thread 01a130a2-b521-7c9e-8dc1-b89193948bd8",
    "expected": "An ending the agent itself waited out via read_output (phase ended, exit 0, first: true) settles the notification debt: the command-result notice goes neither into the model history nor marked Unread in the feed."
  }
---
Filed from project `runlith`.

Thread 01a130a2-b521-7c9e-8dc1-b89193948bd8 records: #1623 bash launched in background; #1630 read_output (wait 120) — ended, exit 0; #1640 signal `transcript:signal:command:fe8bcc94-8204-4f4b-9856-2212c3eb9842:163:call_f19e8199…`, occurredAt 16:02:07.051, entered step 205. Looks like a race: the wait and the notice dispatch decide on the ending independently, and the wait does not settle the notice debt (cf. `wait.revision` in read_command — "the obligation a proved ending discharges"). The agent did not react to the double, but pays in context, and the operator sees a spare unread.
