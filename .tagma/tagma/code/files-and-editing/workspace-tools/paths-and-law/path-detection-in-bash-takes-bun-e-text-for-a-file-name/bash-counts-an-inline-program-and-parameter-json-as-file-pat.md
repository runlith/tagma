---
id: 01a12b17-5722-75b3-b04b-9116e762c5f5
title: Bash counts an inline program and parameter JSON as file paths
ord: 1
tags: ["reflection"]
fields:
  {
    "actual": "Both commands exited 0, but the footer reported \"the files this command printed could not be told apart\" and Unknown: FileSystem.stat for the whole bun -e inline code and the long params string. The EXPLAIN output and the green test result were received; the failure is in path recognition.",
    "command": "functions.bash: bun -e with a SQLite EXPLAIN QUERY PLAN; bun test terminalDelivery.stest.ts with JSON query params in the log",
    "expected": "Successful commands return their results; the source recognizer makes no FileSystem.stat with inline code or a JSON string instead of a path."
  }
---
Filed from project `runlith`.
