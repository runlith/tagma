---
id: 01a0ca97-13c7-79ea-a1a7-321bc0e81e53
title: Write the claims of the sandbox a guest works in, and of the world a command runs in
ord: 209
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0cab6-c29b-7a76-afe3-fa2c44cc92df",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0ca94-63c5-789a-9e91-c36105042d40
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: dir
    ref: apps/tagma/server/src/harness/sandbox
  - kind: dir
    ref: apps/tagma/server/src/harness/worlds
---
Read `harness/sandbox/` and `harness/worlds/` whole. [[4c32fb5a]] already holds the release road with four verified claims — read it first, write nothing that repeats it, and qualify it where the code has moved.

Write the claims of [[3b8682f2]] and [[09d81f01]]: what preparing a tree establishes, what a lease guarantees and for how long, what a guest may reach through the proxy and what it may not, what an interrupted act resumes from, and how a world decides where a command executes and under which identity. The rule [[a00f91b0]] binds here — the sandbox sweep is named in it by measurement, so check the driver and record what you find.

Done when every claim is written from the code and verified after a reading of all its sources, every symbol anchor resolves, `run_doctor` over these paths stands clean, and a review leaves no FALSE, OVERBROAD or UNSUPPORTED unresolved. Precision to match: [[d1caad35]] and [[249ce587]].