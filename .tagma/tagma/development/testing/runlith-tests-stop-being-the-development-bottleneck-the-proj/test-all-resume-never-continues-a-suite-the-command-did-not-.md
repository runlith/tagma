---
id: 01a17af5-fba7-7163-832b-2ba0215013eb
title: "test:all --resume never continues a suite the command did not finish: the report writes only after the first finished suite"
ord: 55
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17af6-1e13-78b7-bdf8-29be502809fb",
    "status": "closed"
  }
edges:
  - kind: discovered-from
    to: 01a17ad9-53ab-70cb-9a5f-ee5de872922e
  - kind: implements
    to: 01a16ac4-44bf-7e0a-8178-b6ff38ef1770
sources:
  - kind: file
    ref: scripts/change/all.ts
---
`test:all --resume` never continues a suite the command did not finish: the report writes only after the first finished suite.

2026-10-27 the git-cuts agent ran `bun run test:all --package apps/tagma/server --script test:integration --report <file>`. The command-life rule killed the run at 10 minutes on 323 of 754 files. `--resume` with the same `--report` fell: `scripts/change/all.ts:90 ENOENT .../integration.json`. The final report never builds until the first suite ends; only the file rows in `.json.d/*.jsonl` remain. Resume (`scripts/change/all.ts:90–109`) works over finished suites, not files. So a suite that never fits one command's life never converges: for server integration under other agents' load that is the usual case. What is needed: the report writes as the run goes, and `--resume` catches up an unfinished suite by files with no verdict only, in the same layout and with the same seed. Final wall and CPU sums and the red list must add up honestly, marked as a multi-pass run.
