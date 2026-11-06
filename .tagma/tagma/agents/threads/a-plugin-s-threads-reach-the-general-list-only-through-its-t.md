---
id: 01a1b1a5-868c-7f7a-9cc4-475729ef140d
title: A plugin's threads reach the general list only through its threads point, and two selections escape the filter by design
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
A plugin lists its threads in the general list only by saying so: the list keeps the set of plugins that registered `threads: {listed: true}`, and every thread whose `bindings.plugin` names another plugin is left out. The default is not listed because a plugin's conversations are its own work, and a person with a tutor and a game table would otherwise find their own threads buried.

The set is the registrations of the `threads` point, so a plugin that is off, removed or never listed counts as unlisted; showing such threads would be a second source of "which plugins exist". The set reaches the list in two places that must agree: the selection every list read goes through (`selected` in `list/select.ts`, which takes it as an argument so no reader can forget it) and the live list, where a hidden row is announced as removed. A change of the set resyncs open lists.

Two selections escape the filter by design: `plugin`, which is how the plugin's card finds its threads, and `ids`, which names threads outright. A child that an agent of a plugin's thread spawns has no `plugin` binding of its own and is not covered; only a thread the plugin created itself, through `create_thread`, carries the binding the server wrote.
