---
id: 01a1a2bd-cd05-789e-a473-61dc0d656dad
title: Versioned directories are one platform kit; pruning holds the exclusive lease until the directory is gone
ord: 86
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1a2ba-87df-748d-bc94-66317e1c6f98",
    "status": "in_work"
  }
---
Finding L4. `pruneVersions` checked `directoryLeased` and then removed without an exclusive hold, so a lease taken in between lost its directory. The set of versioned directories under a root (list, `current` link, next/open version, prune) moves to `platform/lock/versionedDirectories.ts`; installation keeps only its release policy (what to keep), artifacts imports the kit, and both prune through `removeUnleased`.