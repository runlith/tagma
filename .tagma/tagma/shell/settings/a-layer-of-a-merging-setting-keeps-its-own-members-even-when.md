---
id: 01a189de-7fc2-7403-b80e-6e893fbcd611
title: A layer of a merging setting keeps its own members even when they equal what lies beneath; only a replacing key's layer is cleared by an echo
ord: 13
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/settings/store/rows.ts
---
A value written into a layer of a `replace` key that equals what the layers beneath resolve to is stored as no value, so the layer goes back to following them. A layer of a `union` or `concat` key adds to what lies beneath instead of replacing it, so its members are kept even when they equal it: clearing them would erase what the layer itself stands for once the layer beneath changes — a project enabling a plugin that is also enabled for every project would lose it the moment the every-project enabling is dropped, and a project declaring the same MCP server as the person's set would lose its declaration.
