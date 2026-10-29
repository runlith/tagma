---
id: 01a14ced-76be-74d9-af10-e2cd72576848
title: Stopping a command does not report the fate of its resources
ord: 2
tags: ["reflection"]
fields:
  {
    "actual": "The tool answered only “stopped: killed by SIGINT”, with no resource populations; freeing the fixture host's own resources takes a separate endHosts.",
    "command": "stop_command({operationId:'protocol-runs-first-failure-stop',execution:'26099c71-7abc-4530-8cae-b7ee210b1aae',incarnation:167,cause:'run-abort',action:'signal'})",
    "expected": "The stop contract answers with three populations: what completed, what is known to remain, and what could not be measured."
  }
---
Filed from project `runlith`.
