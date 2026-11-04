---
id: 01a1a83a-71a1-7737-bc3e-a0349c5b434b
title: Linux moves a live process's pace on every thread, because nice is per thread
ord: 10
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/execution-host/native/holder/src/linux/sys.rs
---
`setpriority(PRIO_PROCESS, pid)` changes only the thread whose id is the pid, so a running multithreaded program would keep its workers at the old pace while its main thread reported the new one. A live move reads and sets each task under `/proc/<pid>/task` and repeats while threads born of unmoved threads appear, up to a bounded number of passes; the follow loop's next round takes any it missed. A launch needs none of this: the child is lowered while stopped before exec, single-threaded, and its threads inherit.