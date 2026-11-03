---
id: 01a1a310-ba64-74c6-b0db-1a5740edd52c
title: The release toolchain leaves Installation for a module of its own
ord: 96
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1a30d-3192-78c8-a90e-14527d736b6e",
    "status": "done"
  }
---
Installation mixes what runs on a person's machine (closure, process, setup, contract, release moves) with the developer's release toolchain in `installation/cut/` (build, try, trial worlds, cut, proof, DMG, notarize, publish). The toolchain moves to `apps/tagma/server/src/cut/` as its own module that imports Installation through its declared entries; Installation code and tests stop importing it. Shared pieces go to their owner: the local signing identity, used only by builds, moves up with the toolchain; the environment of a beside installation, which the core reads, moves down into the core; the feed-writer frozen test moves to the writer.