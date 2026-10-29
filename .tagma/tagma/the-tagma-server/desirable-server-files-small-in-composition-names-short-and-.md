---
id: 01a0e9ce-6fd1-79ac-a8f7-5c6a8d3638ce
title: "Desirable: server files small in composition, names short and not repeating the owner"
ord: 65
tags: ["rule"]
sources:
  - kind: dir
    ref: apps/tagma/server/src
---
A recommendation for `apps/tagma/server/src`, not a ban:
- a file does not export too many names, and a folder does not grow into a long flat list of files;
- a module has no two files with the same name stem;
- an exported name is short — a long name usually means a missing concept or one owned by the wrong owner;
- a class or interface member does not repeat its owner or file's first word (`Thread.threadId` → `Thread.id`).
