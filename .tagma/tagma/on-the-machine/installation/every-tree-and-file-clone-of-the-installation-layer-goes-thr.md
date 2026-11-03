---
id: 01a1a2bd-7a54-710e-82bb-f618cd99d935
title: Every tree and file clone of the installation layer goes through one primitive in platform/durable
ord: 83
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1a245-7a43-7a67-8046-6e8a2efb5b64",
    "status": "in_work"
  }
---
Review finding M4, first half. Three clone implementations stand: `cloneFile` in `platform/durable/files.ts`, `/bin/cp -c`/`-Rc` with a `cpSync` fallback in `release-channel/install.ts`, and `/bin/cp -Rc`/`-R` in `mac-applications/placement.ts`. The macOS `cp -c` variance sits in the release channel. One tree clone in `platform/durable` holds the platform variance and the space-checked fallback, and the release channel and the application adapter call it.