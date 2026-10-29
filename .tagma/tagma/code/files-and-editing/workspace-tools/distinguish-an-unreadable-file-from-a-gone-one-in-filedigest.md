---
id: 01a0ca96-4f1d-7e20-811c-559c87f1b1ba
title: Distinguish an unreadable file from a gone one in fileDigest
ord: 22
tags: ["task"]
fields:
  {
    "status": "closed"
  }
---
In `packages/agent-tools/src/CheckoutBaselines.ts`, `fileDigest` answers `contentDigest('')` both when the path is gone at stat and when the read stream fails mid-read — so a transient read error on a path that still exists is filed as a deletion. Either mark the mid-read failure unreadable instead of gone, or record why the conflation is safe; then revisit the claims filed over this digest ([[1a79e8bc]], [[f8957aef]]).