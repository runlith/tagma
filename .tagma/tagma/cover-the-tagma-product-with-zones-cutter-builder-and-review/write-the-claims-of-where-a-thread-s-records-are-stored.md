---
id: 01a0ca97-13cd-7b23-9251-05847bce8d94
title: Write the claims of where a thread's records are stored
ord: 210
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0cab7-a637-7709-9759-c876145a5b9a",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0ca94-63c5-789a-9e91-c36105042d40
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: dir
    ref: apps/tagma/server/src/thread
---
Read `apps/tagma/server/src/thread/` whole. [[fc9c26d8]] already holds the rest-and-wake road with ten verified claims and now owns the rollout files by source — read it first and write nothing that repeats it.

Write the claims of [[df47ad01]]: what each port implementation guarantees to the kernel above it, what a read costs against the single write permit, how the transcript, the event log and the replay fold differ in what they carry, what bounding an entry withholds and what it names, and where a reader is served from when the rows are gone.

Done when every claim is written from the code and verified after a reading of all its sources, every symbol anchor resolves, `run_doctor` over these paths stands clean, and a review leaves no FALSE, OVERBROAD or UNSUPPORTED unresolved. Precision to match: [[d1caad35]] and [[249ce587]].