---
id: 01a1a80b-8ea0-7569-8de9-ae8422a99b81
title: Linux socket ownership is proved by inode and process witness
ord: 13
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/execution-host/src/posix/linux/evidence.ts
---
The socket table identifies endpoints, but only a process descriptor proves who owns one. The Linux probe joins those kernel records while keeping the process witness stable; inaccessible or changing owners remain unmeasured rather than being inferred from command text or a printed URL.