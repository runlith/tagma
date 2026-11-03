---
id: 01a14c37-8dfe-7134-b887-9e7378b50b7a
title: The sandbox in an installed release must build the guest image by default
ord: 1
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a14c14-6895-75c6-80f2-47c6411e9f4e
sources:
  - kind: file
    ref: apps/tagma/server/src/cut/release.ts
  - kind: file
    ref: apps/tagma/server/src/sandbox/engine/docker/image.ts
---
`image.ts` builds the guest image from the Dockerfile and the helper next to the server sources, while a release cut assembles only `server.ts`, migrations, and workflows — there is no Docker context in the release, and `prepare_sandbox` has no image parameter of its own. The conclusion from the code needs checking on an installed release. Done when `prepare_sandbox` without a prepared tree works in the release.
