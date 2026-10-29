---
id: 01a135f8-f7eb-72c1-88c2-519be2abbfcc
title: Remove the npm loader and GitHub sign-in; default feed is runlith/tagma
ord: 7
tags: ["task"]
fields:
  {
    "holder": "tagma:01a135ff-0787-74bd-8eb8-f870c5e90b88",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a13209-1c70-7d0c-87f4-40b2e7b7be7f
sources:
  - kind: dir
    ref: packages/release-loader
  - kind: file
    ref: apps/tagma/server/src/release-channel/github.ts
---
Step 1 of the spec's "Work order". Delete `packages/release-loader` whole and `loader.itest.ts`; `release-channel/github.ts` and its test, `release.token`, `release.githubClient` setting, `tagma release sign-in`, `invitation-required` refusal and token substitution in `runner.ts`/`delivery.ts`. `FEED` in `places.ts` is `https://raw.githubusercontent.com/runlith/tagma/main/feed.json`. The `release-channel` module card and its card description go through `set_module` if entries change.

Done: typecheck and `release-channel` tests green; update from a public `https:` archive and from a `file:` feed passes without a token; no `login/device` or `release.token` left in code.
