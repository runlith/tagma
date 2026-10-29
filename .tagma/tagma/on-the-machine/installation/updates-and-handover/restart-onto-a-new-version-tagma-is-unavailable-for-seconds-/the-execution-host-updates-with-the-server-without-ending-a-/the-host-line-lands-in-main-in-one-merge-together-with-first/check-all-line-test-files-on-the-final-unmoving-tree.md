---
id: 01a12b24-bde8-7ed8-b117-e8a216b1babe
title: Check all line test files on the final unmoving tree
ord: 5
tags: ["task"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: discovered-from
    to: 01a12735-55f2-75e0-95d7-53127c1b6811
---
Check all line test files on the final unmoving tree. Rebuild the manifest for execution-host, executions, server executions/thread fixtures, and app executions; exclude six live-Claude files of the old run. Run every file one by one with a single worker with a hard 60 s deadline and standard preload/config. Do not change sources or tests. Hand every failure to the architect at once with the test, output, and the file's last commit. Proof: source and final HEAD/status, the region table, the full file→result table, and uncut logs.
