---
id: 01a189aa-af0e-73ee-b828-261828498339
title: Installed plugin copies and plugin data live in agent-plugins/ and agent-plugin-data/, never plugins/ or plugin-data/
ord: 8
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/plugins/sources.ts
  - kind: file
    ref: apps/tagma/server/src/plugin-host/steps/data.ts
---
The apps carry-over in `tagma-apps/steps/data.ts` moves `<data>/plugins/` and `<data>/plugin-data/` — the directories Tagma apps used before they were renamed — into `apps/` and `app-data/` at every server start. A plugin copy or plugin data kept under those names is moved away on the next start and its install record points at nothing, so the plugins module keeps its copies, its staging and its plugins' data under names the carry-over never touches. A plugin installed from a git URL before this rename was already moved by a restart and is installed again.
