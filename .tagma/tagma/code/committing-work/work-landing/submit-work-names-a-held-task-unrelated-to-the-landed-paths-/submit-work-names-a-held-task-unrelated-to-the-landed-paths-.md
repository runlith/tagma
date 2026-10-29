---
id: 01a16e6d-3235-701a-a0e9-5f6e3c8dda42
title: submit_work names a held task unrelated to the landed paths in the commit subject
ord: 1
tags: ["reflection"]
fields:
  {
    "actual": "The subject got \"(3201be28)\", the session's held task about execution-host SQLite pools, which has no sources under scripts/change",
    "command": "submit_work paths=[scripts/change/chunking.ts, scripts/change/chunking.test.ts] subject=\"Plan chunks from a file's longest observed run instead of the sum of its runs\"",
    "expected": "No task, or the chunking task, in the subject of 16f05224fb"
  }
---
Filed from project `runlith`.