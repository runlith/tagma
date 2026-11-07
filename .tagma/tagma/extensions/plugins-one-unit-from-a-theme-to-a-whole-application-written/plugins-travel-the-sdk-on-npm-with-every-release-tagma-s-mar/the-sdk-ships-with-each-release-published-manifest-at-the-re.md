---
id: 01a1b3f0-1261-7c06-9406-8e37f5f11fd6
title: "The SDK ships with each release: published manifest at the release number, npm step in publishRelease, exact pin and link form of the template, build.sdk, bun and bunx for agents"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1b3f0-8f97-79fe-8ae1-ebd1d0899326",
    "status": "in_work"
  }
edges:
  - kind: implements
    to: 01a1b3e0-3840-721f-8a36-224648d72b26
---
The SDK on npm part of [[48d72b26]]: `kit/build.ts` writes a publishable `dist/package.json` at the release number; `publishRelease` publishes it after `verified` and before the tag, skips the same tarball, refuses different bytes, refuses naming the token variable while it is missing; the template pins the running release exactly, or `link:@runlith/tagma` on a checkout server, which registers its SDK as that link at start; the build writes `build.sdk`; the Fix-with-an-agent thread carries both versions; `bun` and `bunx` over Tagma's runtime last on agents' PATH; the `plugins` skill and the SDK spec's Versions follow. The real npm publish waits for the operator's login.