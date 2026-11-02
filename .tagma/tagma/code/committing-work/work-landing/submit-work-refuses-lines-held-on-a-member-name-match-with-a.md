---
id: 01a188ee-e333-73bd-8f5f-0b97eedd0e97
title: submit_work refuses lines-held on a member-name match with a peer's unrelated declaration
ord: 154
tags: ["reflection"]
fields:
  {
    "actual": "Refused lines-held: \"projectId in apps/tagma/server/src/threads/roads.ts:48, held by 01a188e1-…\" — our only line in a file importing roads.js (threads/assembly.ts) renames PluginPoints to TagmaAppPoints; the landing waits on an unrelated writer.",
    "command": "submit_work checkout=~/runlith/tagma taking=[server-apps, server-views, client-apps, fix-carryover, own-apps, graph-apps] tasks=[05a933b6]",
    "expected": "The landing slices our rename lines and lands them: none of them reference the peer's new RoadAsk.projectId in threads/roads.ts."
  }
---
Filed from project `tagma`.

A landing of ~280 paths across a rename blocks because some selected file uses a member named `projectId` (a very common name) and a peer is adding a type with a `projectId` field. The conservative member-name check refuses without a proven receiver type; for a common member name this makes any large landing depend on unrelated peer work. Workaround: wait for the peer to land.