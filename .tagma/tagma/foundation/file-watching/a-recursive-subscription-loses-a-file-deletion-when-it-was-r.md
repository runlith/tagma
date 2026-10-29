---
id: 01a14c8b-8829-7733-8275-542df93f3ebd
title: A recursive subscription loses a file deletion when it was replaced and deleted in one parcel batch
ord: 2
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a14c68-75fc-7268-bf0d-39b2d620c9b9
sources:
  - kind: file
    ref: packages/watch/src/watcher.ts
---
`EventList` of parcel 2.6.0 (`src/Event.hh`) drops a path that has both a create and a delete in one batch. The FSEvents backend (`src/macos/FSEventsBackend.cc`) calls create and rename over an already-standing file that (Renamed flag with no Modified), inotify calls it `IN_MOVED_TO`. So "atomic write over a file, then deleting it" faster than the debounce window (≥50 ms) gives no event, and a consumer judging by named paths keeps the deleted file alive until the next rescan. Found on the graph recovery feed (`graph/tree/merges.ts` writes a record and deletes it right away); the kit's flat subscriptions already read the directory composition themselves, recursive ones don't.

The root is parcel classification: replacing an existing path must be an update. The fix is a patch of the parcel source and an own build of `watcher.node` after the native asset model of `@runlith/sqlite-process` (build at install, carry into cut, sign in `sealRelease`) for every release platform. Proof: a kit itest — rename over a file and deleting it in one batch gives delete in a recursive subscription.
