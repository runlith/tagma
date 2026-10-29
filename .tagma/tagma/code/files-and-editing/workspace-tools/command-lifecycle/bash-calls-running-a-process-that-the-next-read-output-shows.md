---
id: 01a14cdf-fbdd-7498-a21f-cd60b62892a3
title: bash calls running a process that the next read_output shows finished in 0 s
ord: 6
tags: ["reflection"]
fields:
  {
    "actual": "bash answered \"Moved 7e06e697-ef56-487f-9ada-dc4d02f62e3b:167 to the background: it runs on\" with no stdout. The next read_output returned ended exit0 after0s and three diff lines. Reading an instant read-only command took an extra call; its hold and the process lifetime turned out mixed.",
    "command": "functions.bash({\"command\":\"git diff --numstat -- apps/tagma/server/src/composition/testing/WorktreeFinishing.stest.ts apps/tagma/server/src/composition/testing/http/doorWorldHosts.stest.ts apps/tagma/server/src/composition/testing/plugins/agents.itest.ts apps/tagma/server/src/composition/testing/native-harness/threadInstructions.itest.ts\",\"description\":\"Check outstanding native fixture fix footprint\"})",
    "expected": "When the process already finished, the answer tells its exit apart from a still-running command escort; the \"runs on\" phrase belongs only to a live process."
  }
---
Filed from project `runlith`.

From this data it cannot be established whether the delay was in checkout measurement, the result queue or host observation; the fact is the cost of one extra read and the launch wording contradicting the measured child-process duration. The workaround here is one read_output at the command's address; no repeated git diffs or process changes were made.
