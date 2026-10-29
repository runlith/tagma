---
id: 01a1352d-9cad-78da-813e-b1fc51b6387d
title: "Snapshots before migration serialized by store path: parallel mirror opens at load never take one snapshot twice"
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1351d-309d-776a-b901-a87e70308606",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/platform/store/snapshot.ts
---
At load the server opens graph mirrors in parallel on one `storeSnapshots`. `opened` with a `release` action called `retireReady`, which walked the whole shared `retire` map, so two opens removed one path's snapshot twice: the second `rm(<store>.snapshot.json)` failed `ENOENT lstat`, opening answered `SnapshotFailed`, the project — `graph-pool` refusal (Oct 13: `resume`, `runcoach`).

To do: one path's snapshot-file changes (`take`, `opened`, `release`, `restore`, writing `retireReady`) run under that path's lock; `opened` removes only its own snapshot; different stores stay parallel.

Done when the itest "stores opened together after a later boot…" in `composition/scopedSnapshot.itest.ts`, red before the fix with the same error, is green after, and snapshot and baseline tests are green.
