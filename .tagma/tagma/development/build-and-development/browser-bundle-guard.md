---
id: 01a1428e-f259-70b0-ba48-835441c37464
title: Browser-bundle guard
ord: 3
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "src/browserGuard.ts"
      }
    ],
    "id": "@runlith/vite-browser-guard",
    "kind": "kit"
  }
sources:
  - kind: dir
    ref: packages/vite-browser-guard
---
A browser app that reaches a Node built-in breaks on the user's machine, not at build time, and the kit moves that failure into the build: the Vite plugin in the client environment notices every built-in that did not resolve to a file and fails the build with a list of import chains back to the page — our code and third-party files alike. Which built-ins are acceptable and how to replace them is the app's decision; the kit only refuses to let them through silently.
