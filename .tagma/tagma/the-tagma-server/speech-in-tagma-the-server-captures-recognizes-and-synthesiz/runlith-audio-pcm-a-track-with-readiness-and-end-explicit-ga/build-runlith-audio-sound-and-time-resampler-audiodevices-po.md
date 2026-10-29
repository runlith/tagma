---
id: 01a1050d-b653-758c-bca6-883e76715af2
title: "Build `@runlith/audio`: sound and time, resampler, `AudioDevices` port, helper protocol with client and conformance"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1050e-0e5c-7025-bc02-1d07c6a1e98d",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0ff30-3ce0-7879-8c00-c3779d375daf
---
New `packages/audio` package per spec [[9d375daf]]. First commit — sound types and the port (`Chunk`, `Gap`, `Track`, format, `AudioDevices`, `Player`): `@runlith/speech` and the helper stand on them. Then the resampler, the helper protocol, the TS client over the channel port, and the `testing` and `conformance` entries. Done when the tests from the “Proof” section are green and the package has its `#module` card.
