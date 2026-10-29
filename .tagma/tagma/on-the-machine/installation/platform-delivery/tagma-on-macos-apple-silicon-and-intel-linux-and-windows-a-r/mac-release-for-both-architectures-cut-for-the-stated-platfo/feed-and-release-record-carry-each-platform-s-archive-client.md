---
id: 01a175e1-b116-7055-8be6-30fc68119cc2
title: Feed and release record carry each platform's archive, client takes its own machine's archive
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a175e2-6405-7995-bf51-57ca644f6e2d",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a175e1-b116-7055-8be6-30f9fb401399
---
Each release in the release feed carries `platforms` — archive, sha256 and size per platform; flat fields stay the `darwin-arm64` archive for issued 0.1.x. The cut record carries all platforms' archives, `publish` uploads each. The client takes its own machine platform's archive (on Mac — by `hw.optional.arm64`, one owner in installation), and a release with no archive for its platform is not offered, naming the cause. The mechanism — in the spec.
