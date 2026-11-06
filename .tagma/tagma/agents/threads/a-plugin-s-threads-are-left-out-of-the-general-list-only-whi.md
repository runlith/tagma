---
id: 01a1b1a5-868c-7f7a-9cc4-475729ef140d
title: A plugin's threads are left out of the general list only while its plugin runs in their project without listing them
ord: 173
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/listing.ts
  - kind: file
    ref: apps/tagma/server/src/threads/list/select.ts
  - kind: file
    ref: apps/tagma/server/src/threads/list/threadList.ts
  - kind: file
    ref: apps/tagma/server/src/threads/contract/wire/listing.ts
---
A plugin's conversations are its own work, so a thread whose `bindings.plugin` names a plugin is left out of the general list — every list page, count, live list, bulk and archive selection — only while that plugin is enabled in the thread's project and has not registered `threads: {listed: true}`. A plugin that is switched off in that project, removed or never installed leaves its threads ordinary threads in the list, so a person who removes a tutor keeps its conversations. Without the leaving-out, a person with a tutor and a game table would find their own threads buried.

The decision is the plugins owner's enabled set of each project minus the listed registrations of the `threads` point, read through `PluginPoints.hold` (`threads/listing.ts`). Its answer, a map from project to the plugins to hide, reaches every reader as an argument of `selected` (`list/select.ts`), so no reader can forget it. An empty map adds no predicate; otherwise the binding is reached through the mandate table object. The live list asks the same service for each row. A change of the enabled set or of the registrations that changes the answer resyncs open lists.

Families follow the same decision. The window and family insertion (`liveFamilyOf`, `families`) stop at a hidden thread, so its descendants leave with it and a hidden bound child under a visible parent is left out; `announce` removes a row that is hidden or stands below a hidden one the list holds. A flat list checks each row's own binding only, so a visible child of a hidden thread still lists there.

Two selections escape the filter by design: `plugin`, which is how the plugin's card finds its threads, and `ids`, which names threads outright. A child that an agent of a plugin's thread spawns has no `plugin` binding of its own and is not covered; only a thread the plugin created itself, through `create_thread`, carries the binding the server wrote.
