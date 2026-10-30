---
id: 01a18d86-3364-7c94-ac2b-91a6c0348282
title: A path field is placed in the deepest registered checkout holding it, and a relative one reaches the body respelled for that checkout
ord: 30
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/workspace/subjects.ts
---
An absolute path names its own project; a relative one is read from the checkout the call stands in, and either is placed in the deepest registered root holding it. So a project-relative path that crosses into another project's checkout nested in this one — a submodule registered as its own project — moves the call there, exactly as the same path spelled absolute does, and the operation body receives it respelled relative to that checkout. Without the respelling the body would look the outer project's spelling up in the nested graph and find nothing.

A path that stays in the calling project keeps its spelling. A relative path with no checkout behind the call places nothing and the call stays where it was.
