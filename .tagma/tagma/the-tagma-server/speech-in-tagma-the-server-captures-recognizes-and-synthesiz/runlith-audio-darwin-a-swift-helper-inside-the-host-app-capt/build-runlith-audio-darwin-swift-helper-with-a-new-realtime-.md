---
id: 01a1050d-b653-758c-bca6-8840b6141481
title: "Build `@runlith/audio-darwin`: Swift helper with a new realtime path, LaunchServices launch, embedding into `Tagma.app`"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1050e-6092-729e-be54-9de1454bc39a",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0ff30-3ce0-7879-8c00-c378acba5047
  - kind: waits-on
    to: 01a1050d-b653-758c-bca6-883e76715af2
---
New `packages/audio-darwin` package per spec [[acba5047]]; protocol and client come from `@runlith/audio`. The CoreAudio part moves over from `packages/audio-capture-darwin/native/audiotee`. Done when the Swift tests and the conformance run against the built helper are green, and `build-host.ts` embeds and signs the helper.
