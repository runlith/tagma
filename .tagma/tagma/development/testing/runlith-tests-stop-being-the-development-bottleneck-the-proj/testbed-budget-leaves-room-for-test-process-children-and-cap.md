---
id: 01a17b34-b3a8-7afd-8224-13537a1511cb
title: Testbed budget leaves room for test-process children and caps workers by machine memory
ord: 60
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16e20-3dd6-7696-901e-d29696ccb336",
    "status": "in_work"
  }
edges:
  - kind: discovered-from
    to: 01a17b03-a13b-7f89-877a-c88bd6678b58
  - kind: implements
    to: 01a16ac4-44bf-7e0a-8178-b6ff38ef1770
sources:
  - kind: file
    ref: packages/testbed/src/slots.ts
---
In the first window of the measured server-integration curve, the previous 10 workers on a 12-core, 32 GiB machine overloaded CPU and memory: comparable files got more expensive, throughput fell. A neighbouring repeat pair did not confirm CPU growing universally with worker count; the cap on measurement outputs is kept in [[026f978d|measurement note]]. The adopted conservative default: the minimum of 2/3 of available cores and half the machine's available memory with a 2 GiB envelope per worker including children, at least one worker; the previous minimum reserve for interactive work stands. Container memory bounds physical memory. The formula is held by testbed; the CLI and the shared scheduler read it from the one place. After landing — the whole `bun run test:all` as one command without `--jobs` and `--package`; name the measurement-output cap and others' reds separately.
