---
id: 01a17fa5-e652-7c7d-aeff-a97a48be988d
title: A world-state section is judged by the last standing history context message that told it; losing a late turn removes only what it told
ord: 30
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a17f69-7cca-7d27-b6b0-831ef7fd2c9d
  - kind: relates
    to: 01a17f7a-7848-7ac9-9bac-5f3a2ce62660
sources:
  - kind: symbol
    ref: apps/tagma/server/src/native-harness/turns/message.ts
    symbol: nativeTurnContext
  - kind: symbol
    ref: packages/agent/src/agent/WorldState.ts
    symbol: renderWorldState
---
Each context message carries in metadata what it said: `told` — the fingerprint of the told value for every world-state section (`null` means the section removed), `graph` — the graph-event interval `{from, through}` its digest told. `renderWorldState` judges a section by the last history message that spoke of it, not by the snapshot. Fingerprint matched the snapshot value — the model knows that value. Matched the current one — nothing to say. Matched neither — the model knows another value, and the section is spoken as an update. No standing message spoke of the section or spoke a removal — the section is spoken from scratch.

So a late-turn rollback removes only what that turn told. Previously any loss of told content dropped the whole snapshot, and after a rollback the model received the skill catalog, instruction files, work note, and fork mark a second time next to the first ones, and the graph from the map (`sinceEventId: 0`). Now on loss the graph continues from the end of continuous coverage from the map: standing messages' intervals go by `from`, and the first hole stops it. The last standing `through` is unfit for this: after two mid-history rollbacks it would jump the hole, and what was told inside would never arrive again. From zero — only if no map remains in history: a fork slice, a rollback to the first turn. Events told by lost messages arrive again; what was told past the hole may arrive twice.

`contextRuns` after a loss keeps the runs whose messages still stand, not an empty list: otherwise a later loss would have nothing to notice it by. Metadata never goes on the model wire, so the request prefix and prompt cache do not change. Messages without `told` (written before this mechanism) name no section, and the old rule applies to them: on loss such a section is retold.
