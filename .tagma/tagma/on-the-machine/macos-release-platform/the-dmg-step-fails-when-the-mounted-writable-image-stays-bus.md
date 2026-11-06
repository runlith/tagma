---
id: 01a1b1f7-95e8-7910-b964-285c16ff99b9
title: The DMG step fails when the mounted writable image stays busy at detach
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a19eb2-4a56-79d0-9dbd-af67ec98a662",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/mac-release/dmg.ts
---
In macOS integration run 42258729273 `dmg.darwin.itest.ts` failed with `hdiutil detach exited 16: hdiutil: couldn't eject "disk7" - Resource busy` although `dmg.ts` detaches with `-force`, and a `diskimages-helper -post-exec` process outlived the test. The runner's machine log showed `mds_stores` and `diskimageiod` busy at the time, so the volume was probably held by Spotlight or the image helper (inferred, not proven). A real release on a busy Mac would refuse the same way. Find what holds the volume and end the wait on the fact that releases it — for example keep the writable volume out of indexing — rather than retrying the detach.