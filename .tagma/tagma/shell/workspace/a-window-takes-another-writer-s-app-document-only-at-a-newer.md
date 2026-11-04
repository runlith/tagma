---
id: 01a1a699-a38c-78af-8ddf-453afc74f1e9
title: A window takes another writer's app document only at a newer revision, and holds it back while its own write to that key is unanswered
ord: 5
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a1a688-b53e-7c02-adc5-2f5d917e62cd
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/workspace/ServerAppState.svelte.ts
  - kind: file
    ref: apps/tagma/server/src/app-state/layer.ts
---
Several windows write the same few documents, each through its own copy, and the server orders every write by one revision that grows across all keys. A window therefore never compares values, only revisions: it takes another writer's change only when its revision is newer than what it already holds for that key, so a change delivered late — a feed that resumed, a read that crossed a write — cannot roll a window back.

Its own write is the subtle case. The window shows the new value at once, and the server answers its revision only later; a foreign change that arrives meanwhile may be older or newer than that write at the server. So it waits until the window's writes to that key are answered and is taken only if it is newer than the last of them. Taking it at once would show the foreign value while the server keeps the window's own, and the window's echo, which it ignores, would never correct it.

A window can also miss changes while its connection is down. The feed opens every subscription with the revision the server stands at, and a window whose last read is older reads all documents again, so a gap closes on reconnect without a feed of history. Heard changes never count as that proof: the server publishes each write after its commit, and publications of different writes are not ordered, so a window may hear a newer revision before an older one it then misses. A failed write makes the window forget what it knew of that key and owe one more read, which only a read started after the failure discharges: a read already in flight answers a snapshot that may predate writes landed meanwhile. So the server's value comes back instead of a copy the server never accepted.

Before the first read lands the window holds nothing, so a write would replace a document it has not seen: writing is a defect until `ready`; effects that write on arrival wait for it, an operator's act made earlier runs once the documents land (`whenReady`), and the root page resumes a project only after they did. The keys moved from this browser's `localStorage` leave it only after the server answered their write.
