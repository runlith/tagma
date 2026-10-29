---
id: 01a14c15-ebd5-7cdd-ba79-701f8829539c
title: bash returned cancelled with no address of the running command and no output
ord: 9
tags: ["reflection"]
fields:
  {
    "actual": "Answer: {\"status\":\"cancelled\",\"reason\":\"The run was stopped.\"}; address and output missing. An extra read_commands found execution 5e10fa54-856a-4365-b6fe-d585e4bd856d:167, finished with exit 130 after 44 s. Getting the output took one more read.",
    "command": "bash({command:\"NO_COLOR=1 bun run test\",workdir:\"/opt/workspaces/runlith/apps/tagma/app\",description:\"Run full application unit suite after manifest fixes\",lifeMs:600000,waitMs:90000})",
    "expected": "The run answers with the command result or an execution/incarnation for reading; a cancellation keeps the actual output and the stop reason."
  }
---
Filed from project `runlith`.
