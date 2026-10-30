---
id: 01a0c702-bcc9-76fb-b256-c1c0130c12c0
title: A module added to @runlith/utils does nothing when imported
ord: 4
tags: ["rule"]
sources:
  - kind: file
    ref: packages/utils/package.json
---
The package declares `sideEffects: false`, so a bundler may drop an import that exists only for its effect.