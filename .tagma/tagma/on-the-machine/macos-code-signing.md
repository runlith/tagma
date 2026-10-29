---
id: 01a13b1a-1851-79b3-ba84-3b0e9f581885
title: macOS code signing
ord: 36
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "src/codesign.ts"
      }
    ],
    "id": "@runlith/codesign",
    "kind": "kit"
  }
sources:
  - kind: dir
    ref: packages/codesign
---
Tagma signs its code on macOS: window, helpers, release native programs and execution host. The package owns how this is done one way: recognize Mach-O by header and sign the file via `/usr/bin/codesign` with hardened runtime, its own entitlements and, for release, Apple's secured timestamp, without which the signature will not pass notarization. Which identity to sign with and what exactly — the callers decide.
