---
id: 01a128a0-5868-7e5c-b228-6e7a86f86bb6
title: Read-only git show attributes another merge's temp files to the reviewer
ord: 13
tags: ["reflection"]
fields:
  {
    "actual": "The answer reported \"3 files moved while this ran, all attributed to this session\". read_changes listed .merge_file_d0Q8fb, .merge_file_fOn1jV, and .merge_file_mkfgnU as held by this run, while answering \"this session holds 0 paths\". The reviewer created none of these files; two more reads went to verify the attribution.",
    "command": "functions.bash({\"command\":\"git show b21ad5dc94:packages/execution-host/src/ExecutionInput.ts | nl -ba | head -223 && git show f5974c09cf:packages/execution-host/src/Pacing.ts | nl -ba | head -152 && git show b21ad5dc94:packages/execution-host/src/ExecutionCapacity.test.ts | nl -ba | tail -195 | head -34\",\"description\":\"Confirm finding anchors and scope of tests\"})",
    "expected": "The command only reads three git blobs and attributes no recorded files to this review."
  }
---
Filed from project `runlith`.
