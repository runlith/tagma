---
id: 01a1a82f-038a-7d8f-9f68-e827d14290df
title: The Linux census counts the user's tasks, because RLIMIT_NPROC counts threads
ord: 15
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/execution-host/src/posix/linux/facts.ts
---
Linux charges every task of a real UID, threads included, against RLIMIT_NPROC. Counting processes would leave room the kernel refuses at fork with EAGAIN, so the census sums the thread counts of the processes whose real UID is the caller's. A live execution still deducts one, which every task-counted leader covers, so the remaining figure only errs toward refusal.