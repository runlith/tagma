---
id: 01a13c81-0041-77b6-a3c7-99daedc31ad0
title: A deleted thread remembered as the last place leads to a new chat on open, not to "This thread could not be read"
ord: 7
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a13c76-28d8-728a-ab05-deee44e158a3
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/ThreadSlot.svelte.ts
---
Opening Tagma returns to the project's last thread (`Visits.resume`). If that thread is deleted, the operator lands on “This thread could not be read” instead of a new chat. `[project]/+layout.svelte` then remembers the dead id again, and every next open leads there.

**Why separate:** `ThreadSlot.bind` (`abandon('unreadable')`) does not distinguish “no such thread” from “reading failed right now”. Leading into a draft on any `unreadable` would throw the operator out of the thread on a server failure.

**Do:** the thread-reading owner reports “no such thread” as a separate outcome. On that outcome the chat replaces the address with the draft (`/<project>/chat`, `replaceState`), and `Visits` rewrites the place itself.

**Proof:** a thread remembered and then deleted leads to a new chat when `/` opens; a transient read error keeps the operator in the thread.
