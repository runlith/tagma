---
id: 01a199f8-681c-7449-8591-c63d0d26422a
title: Hunk 2 of the svelte patch gets a trap that runs in this repository
ord: 48
tags: ["task"]
fields:
  {
    "status": "open"
  }
sources:
  - kind: file
    ref: patches/svelte@5.57.0.hunks.json
---
`patches/svelte@5.57.0.hunks.json` proves hunk 2 (`Batch.schedule` no longer bails on a cleared `CLEAN`) only by an end-to-end spec of a downstream application, which does not run here, so `patches:prove` prints the trap instead of running it. Find what makes a committed batch be processed a second time with the same root (`patches/README.md`, section 2), reproduce it in `packages/layer`, and name that test as the hunk's trap. Done when `bun run patches:prove 02-schedule` runs the trap, red without the hunk and green with it.