---
id: 01a135f8-f7ec-73bb-8f3f-20a2a3dfab10
title: "tagma:release publish: GitHub Release with archive and DMG, then feed.json"
ord: 9
tags: ["task"]
fields:
  {
    "holder": "tagma:01a135ff-078b-708b-9fbc-19c9fb2ffaed",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a13209-1c70-7d0c-87f4-40b2e7b7be7f
sources:
  - kind: file
    ref: apps/tagma/server/src/cut/publish.ts
---
Spec section "Distribution". Through `gh`: Release with the release tag, archive and DMG upload, then the `feed.json` commit to `main` — feed last. Repo is a parameter; checked against a test repo created with the operator's consent. Only the operator's word creates `runlith/tagma` and uploads the first release.

Done: against the test repo the release appears in Releases, the feed changes only after the upload, an installed copy sees the release and installs it.
