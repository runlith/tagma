---
id: 01a189aa-af0e-73ee-b828-261828498339
title: A plugin's data lives in agent-plugin-data/<id>/, apart from its installed copy in agent-plugins/<id>/, which an update replaces whole
ord: 8
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/plugins/sources.ts
---
A plugin's data directory is `<data>/agent-plugin-data/<id>/`, apart from its installed copy in `<data>/agent-plugins/<id>/`, because an update replaces the copy whole: the staged revision is renamed over the former one, so anything written inside the copy would be lost on the next install from a git URL or a marketplace entry. A folder installed in place gets the same data directory, so moving a plugin between a folder and a git source keeps its data. The directory is made before the process starts, reaches a plugin in Tagma's format as `TAGMA_PLUGIN_DATA`, holds its views' storage, and outlives uninstalling.
