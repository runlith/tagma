---
id: 01a1857e-c6b6-77c9-b522-5aeaa23c5891
title: Managed download progress keeps the page recorded at download start
ord: 11
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/managed-browser/downloads.ts
---
Chromium's progress event identifies a download by GUID but carries no frame identity. Its originating page is therefore fixed when the download starts, so a later frame navigation or removal cannot move progress onto another page or lose it.